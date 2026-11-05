import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import { UnauthorizedError } from "../src/lib/privy";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
let failInsertInto: string | null = null;
let nextId = 0;
const A = "10000000-0000-4000-8000-00000000000a";
const B = "10000000-0000-4000-8000-00000000000b";
const C = "10000000-0000-4000-8000-00000000000c";
const N = "10000000-0000-4000-8000-00000000000d";

// Controlled SDK boundary: the real route handlers run against a small in-memory store.
mock.module("../src/lib/privy.ts", { namedExports: {
  UnauthorizedError,
  requirePrivyUser: async (request: Request) => {
    const token = request.headers.get("authorization");
    if (!token?.startsWith("Bearer account-")) throw new UnauthorizedError("Invalid token");
    return token.slice(7);
  },
} });

mock.module("../src/lib/supabase-server.ts", { namedExports: {
  getSupabaseAdmin: () => ({ from: (table: string) => {
    let operation = "select";
    let payload: Row | Row[] = {};
    const filters: ((row: Row) => boolean)[] = [];
    function execute(): { data: Row[] | null; error: { message: string; code?: string } | null } {
      if (operation === "insert") {
        if (failInsertInto === table) return { data: null, error: { message: "private database detail" } };
        const items = (Array.isArray(payload) ? payload : [payload]).map((row): Row => (
          table === "groups" || table === "splits" ? { id: `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`, created_at: "now", ...row } : { ...row }
        ));
        const duplicate = table === "group_members" && items.some((item) => tables.group_members.some(
          (row) => row.group_id === item.group_id && row.user_id === item.user_id));
        if (duplicate) return { data: null, error: { message: "duplicate key", code: "23505" } };
        tables[table].push(...items);
        return { data: items, error: null };
      }
      const matching = tables[table].filter((row) => filters.every((filter) => filter(row)));
      if (operation === "delete") {
        tables[table] = tables[table].filter((row) => !matching.includes(row));
        if (table === "groups") {
          const ids = matching.map((row) => row.id);
          tables.group_members = tables.group_members.filter((row) => !ids.includes(row.group_id));
        }
        return { data: null, error: null };
      }
      return { data: matching.map((row) => ({ ...row })), error: null };
    }
    const query = {
      select: () => query,
      insert: (input: Row | Row[]) => { operation = "insert"; payload = input; return query; },
      delete: () => { operation = "delete"; return query; },
      eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
      in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return query; },
      single: async () => {
        const result = execute();
        return result.error ? result : { data: result.data?.[0] ?? null, error: result.data?.length ? null : { message: "no rows" } };
      },
      maybeSingle: async () => {
        const result = execute();
        return result.error ? result : { data: result.data?.[0] ?? null, error: null };
      },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(execute()).then(resolve, reject),
    };
    return query;
  } }),
} });

const { POST: createGroup } = await import("../src/app/api/groups/route");
const { POST: addMember } = await import("../src/app/api/groups/[id]/members/route");
const { DELETE: removeMember } = await import("../src/app/api/groups/[id]/members/[userId]/route");
const { POST: addBill } = await import("../src/app/api/groups/[id]/splits/route");

function request(body: unknown, account = "account-a", method = "POST") {
  return new Request("http://localhost/api/groups", {
    method,
    headers: { Authorization: `Bearer ${account}`, "Content-Type": "application/json" },
    body: method === "DELETE" ? undefined : JSON.stringify(body),
  });
}

/** Alice creates a group with Bob; returns its id. */
async function aliceAndBob() {
  const { group } = await (await createGroup(request({ name: "Trip", members: ["bob"] }))).json();
  return group.id as string;
}
function add(groupId: string, username: unknown, account = "account-a") {
  return addMember(request({ username }, account), { params: Promise.resolve({ id: groupId }) });
}
function remove(groupId: string, userId: string, account = "account-a") {
  return removeMember(request(null, account, "DELETE"), { params: Promise.resolve({ id: groupId, userId }) });
}
const memberIds = () => tables.group_members.map((row) => row.user_id);
function bill(groupId: string, body: unknown, account = "account-a") {
  return addBill(request(body, account), { params: Promise.resolve({ id: groupId }) });
}
/** Alice, Bob and Carol in one group; returns its id. */
async function threePeople() {
  const id = await aliceAndBob();
  await add(id, "carol");
  return id;
}

beforeEach(() => {
  failInsertInto = null;
  tables = {
    users: [
      { id: A, privy_id: "account-a", username: "alice" },
      { id: B, privy_id: "account-b", username: "bob" },
      { id: C, privy_id: "account-c", username: "carol" },
      { id: N, privy_id: "account-new", username: null },
    ],
    groups: [],
    group_members: [],
    splits: [],
    requests: [],
  };
});

test("creates a group with the caller and listed members", async () => {
  const response = await createGroup(request({ name: "  Roommates ", members: ["Bob", "carol"], created_by: B }));
  assert.equal(response.status, 201);
  const { group } = await response.json();
  assert.equal(group.name, "Roommates");
  assert.equal(tables.groups.length, 1);
  assert.equal(tables.groups[0].created_by, A);
  assert.deepEqual(tables.group_members.map((row) => row.user_id), [A, B, C]);
  assert.ok(tables.group_members.every((row) => row.group_id === group.id));
});

test("a group can start with only the caller", async () => {
  assert.equal((await createGroup(request({ name: "Just me" }))).status, 201);
  assert.deepEqual(tables.group_members.map((row) => row.user_id), [A]);
});

test("invalid names and member lists are rejected without writing", async () => {
  for (const body of [
    { name: "   ", members: [] },
    { name: 42, members: [] },
    { name: "x".repeat(51), members: [] },
    { name: "Trip", members: "bob" },
    { name: "Trip", members: ["bob", "BOB"] },
    { name: "Trip", members: ["alice"] },
    { name: "Trip", members: ["a b"] },
  ]) {
    assert.equal((await createGroup(request(body))).status, 400, JSON.stringify(body));
  }
  const malformed = new Request("http://localhost", { method: "POST", headers: { Authorization: "Bearer account-a" }, body: "{" });
  assert.equal((await createGroup(malformed)).status, 400);
  assert.equal(tables.groups.length, 0);
});

test("unknown usernames are reported", async () => {
  const response = await createGroup(request({ name: "Trip", members: ["bob", "nobody"] }));
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /@nobody/);
  assert.equal(tables.groups.length, 0);
});

test("callers without a profile or username cannot create groups", async () => {
  assert.equal((await createGroup(request({ name: "Trip" }, "account-new"))).status, 409);
  assert.equal((await createGroup(request({ name: "Trip" }, "account-ghost"))).status, 409);
  assert.equal((await createGroup(request({ name: "Trip" }, "invalid"))).status, 401);
  assert.equal(tables.groups.length, 0);
});

test("a failed member insert removes the group and hides database details", async () => {
  failInsertInto = "group_members";
  const response = await createGroup(request({ name: "Trip", members: ["bob"] }));
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /private/);
  assert.equal(tables.groups.length, 0);
});

test("members can add existing users by username", async () => {
  const id = await aliceAndBob();
  const response = await add(id, "  Carol ", "account-b");
  assert.equal(response.status, 201);
  assert.deepEqual((await response.json()).member, { user_id: C, username: "carol" });
  assert.deepEqual(memberIds(), [A, B, C]);
});

test("adding rejects bad ids, outsiders, unknown users and duplicates", async () => {
  const id = await aliceAndBob();
  assert.equal((await add("not-a-uuid", "carol")).status, 400);
  assert.equal((await add("00000000-0000-4000-8000-999999999999", "carol")).status, 404);
  assert.equal((await add(id, "carol", "account-c")).status, 403);
  assert.equal((await add(id, "a b")).status, 400);
  assert.equal((await add(id, "nobody")).status, 404);
  assert.equal((await add(id, "bob")).status, 409);
  assert.equal((await add(id, "carol", "invalid")).status, 401);
  assert.deepEqual(memberIds(), [A, B]);
});

test("the creator can remove other members", async () => {
  const id = await aliceAndBob();
  assert.equal((await remove(id, B)).status, 200);
  assert.deepEqual(memberIds(), [A]);
  assert.equal((await remove(id, B)).status, 404);
});

test("members can leave but can't remove others or the creator", async () => {
  const id = await aliceAndBob();
  await add(id, "carol");
  assert.equal((await remove(id, C, "account-b")).status, 403);
  assert.equal((await remove(id, A, "account-b")).status, 403);
  assert.equal((await remove(id, A)).status, 403);
  assert.equal((await remove(id, B, "account-b")).status, 200);
  assert.deepEqual(memberIds(), [A, C]);
});

test("removing rejects bad ids and outsiders", async () => {
  const id = await aliceAndBob();
  assert.equal((await remove("not-a-uuid", B)).status, 400);
  assert.equal((await remove(id, "not-a-uuid")).status, 400);
  assert.equal((await remove(id, B, "account-c")).status, 403);
  assert.equal((await remove(id, B, "invalid")).status, 401);
  assert.deepEqual(memberIds(), [A, B]);
});

test("an even bill creates one request per other member, and none for the caller", async () => {
  const id = await threePeople();
  const response = await bill(id, { description: " Dinner ", total: "10", mode: "even", requester_id: B });
  assert.equal(response.status, 201);
  const { split, requests } = await response.json();
  assert.equal(split.group_id, id);
  assert.equal(split.created_by, A);
  assert.equal(split.description, "Dinner");
  assert.equal(split.total, "10");
  assert.equal(requests.length, 2);
  assert.deepEqual(tables.requests.map((row) => row.payer_id).sort(), [B, C]);
  assert.ok(tables.requests.every((row) => (
    row.requester_id === A && row.split_id === split.id && row.note === "Dinner" && row.status === "pending"
  )));
  // A has the lowest id, so A keeps the extra base unit; B and C owe the smaller share.
  assert.ok(tables.requests.every((row) => row.amount === "3.333333"));
});

test("a custom bill uses the given amounts and skips members left out", async () => {
  const id = await threePeople();
  const response = await bill(id, {
    description: "Taxi", total: "10.50", mode: "custom",
    shares: [{ userId: A, amount: "4" }, { userId: B, amount: "6.5" }],
  });
  assert.equal(response.status, 201);
  assert.deepEqual(tables.requests.map((row) => [row.payer_id, row.amount]), [[B, "6.5"]]);
});

test("the member who adds a bill is the one owed, whoever created the group", async () => {
  const id = await threePeople();
  assert.equal((await bill(id, { description: "Taxi", total: "2", mode: "even" }, "account-b")).status, 201);
  assert.ok(tables.requests.every((row) => row.requester_id === B));
  assert.deepEqual(tables.requests.map((row) => row.payer_id).sort(), [A, C]);
});

test("bills reject outsiders and bad input without writing", async () => {
  const id = await threePeople();
  const even = { description: "Dinner", total: "10", mode: "even" };
  const custom = (shares: unknown) => ({ description: "Dinner", total: "10", mode: "custom", shares });

  assert.equal((await bill(id, even, "invalid")).status, 401);
  assert.equal((await bill("not-a-uuid", even)).status, 400);
  assert.equal((await bill("00000000-0000-4000-8000-999999999999", even)).status, 404);
  assert.equal((await bill(id, { ...even, description: "   " })).status, 400);
  assert.equal((await bill(id, { ...even, description: "x".repeat(141) })).status, 400);
  assert.equal((await bill(id, { ...even, total: "0" })).status, 400);
  assert.equal((await bill(id, { ...even, total: "1.1234567" })).status, 400);
  assert.equal((await bill(id, { ...even, total: "10001" })).status, 400);
  assert.equal((await bill(id, { ...even, total: "0.000002" })).status, 400);
  assert.equal((await bill(id, { ...even, mode: "half" })).status, 400);
  assert.equal((await bill(id, custom("nope"))).status, 400);
  assert.equal((await bill(id, custom([null]))).status, 400);
  // Shares that don't add up, name a non-member, repeat someone, or have a bad amount.
  assert.equal((await bill(id, custom([{ userId: B, amount: "9" }]))).status, 400);
  assert.equal((await bill(id, custom([{ userId: N, amount: "10" }]))).status, 400);
  assert.equal((await bill(id, custom([{ userId: B, amount: "5" }, { userId: B, amount: "5" }]))).status, 400);
  assert.equal((await bill(id, custom([{ userId: B, amount: "-10" }]))).status, 400);
  // The caller can't be the only person on the bill.
  assert.equal((await bill(id, custom([{ userId: A, amount: "10" }]))).status, 400);

  assert.equal(tables.splits.length, 0);
  assert.equal(tables.requests.length, 0);
});

test("non-members can't add a bill, and a group of one has nobody to split with", async () => {
  const id = await aliceAndBob();
  const even = { description: "Dinner", total: "10", mode: "even" };
  assert.equal((await bill(id, even, "account-c")).status, 403);
  const { group } = await (await createGroup(request({ name: "Solo" }))).json();
  assert.equal((await bill(group.id, even)).status, 400);
  assert.equal(tables.splits.length, 0);
});

test("a failed request insert removes the split and hides database details", async () => {
  const id = await threePeople();
  failInsertInto = "requests";
  const response = await bill(id, { description: "Dinner", total: "10", mode: "even" });
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /private/);
  assert.equal(tables.splits.length, 0);
  assert.equal(tables.requests.length, 0);
});
