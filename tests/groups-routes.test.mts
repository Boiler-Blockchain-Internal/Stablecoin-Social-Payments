import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import { UnauthorizedError } from "../src/lib/privy";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
let failInsertInto: string | null = null;
let nextId = 0;

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
        const items = (Array.isArray(payload) ? payload : [payload]).map((row) => (
          table === "groups" ? { id: `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`, created_at: "now", ...row } : { ...row }
        ));
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

function request(body: unknown, account = "account-a") {
  return new Request("http://localhost/api/groups", {
    method: "POST",
    headers: { Authorization: `Bearer ${account}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  failInsertInto = null;
  tables = {
    users: [
      { id: "u-a", privy_id: "account-a", username: "alice" },
      { id: "u-b", privy_id: "account-b", username: "bob" },
      { id: "u-c", privy_id: "account-c", username: "carol" },
      { id: "u-n", privy_id: "account-new", username: null },
    ],
    groups: [],
    group_members: [],
  };
});

test("creates a group with the caller and listed members", async () => {
  const response = await createGroup(request({ name: "  Roommates ", members: ["Bob", "carol"], created_by: "u-b" }));
  assert.equal(response.status, 201);
  const { group } = await response.json();
  assert.equal(group.name, "Roommates");
  assert.equal(tables.groups.length, 1);
  assert.equal(tables.groups[0].created_by, "u-a");
  assert.deepEqual(tables.group_members.map((row) => row.user_id), ["u-a", "u-b", "u-c"]);
  assert.ok(tables.group_members.every((row) => row.group_id === group.id));
});

test("a group can start with only the caller", async () => {
  assert.equal((await createGroup(request({ name: "Just me" }))).status, 201);
  assert.deepEqual(tables.group_members.map((row) => row.user_id), ["u-a"]);
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
