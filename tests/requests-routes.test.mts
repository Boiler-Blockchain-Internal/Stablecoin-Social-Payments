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
const HASH = `0x${"ab".repeat(32)}`;
const OTHER_HASH = `0x${"cd".repeat(32)}`;

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
    let payload: Row = {};
    const filters: ((row: Row) => boolean)[] = [];
    function execute(): { data: Row[] | null; error: { message: string; code?: string } | null } {
      if (operation === "insert") {
        if (failInsertInto === table) return { data: null, error: { message: "private database detail" } };
        if (table === "transactions" && tables.transactions.some((row) => row.tx_hash === payload.tx_hash)) {
          return { data: null, error: { message: "duplicate key", code: "23505" } };
        }
        const row = { id: `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`, created_at: "now", ...payload };
        tables[table].push(row);
        return { data: [row], error: null };
      }
      const matching = tables[table].filter((row) => filters.every((filter) => filter(row)));
      if (operation === "update") matching.forEach((row) => Object.assign(row, payload));
      return { data: matching.map((row) => ({ ...row })), error: null };
    }
    const query = {
      select: () => query,
      order: () => query,
      insert: (input: Row) => { operation = "insert"; payload = input; return query; },
      update: (input: Row) => { operation = "update"; payload = input; return query; },
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

const { POST: createRequest, GET: listRequests } = await import("../src/app/api/requests/route");
const { POST: answerRequest } = await import("../src/app/api/requests/[id]/route");

function request(body: unknown, account = "account-a", url = "http://localhost/api/requests") {
  return new Request(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${account}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
function answer(id: string, body: unknown, account = "account-b") {
  return answerRequest(request(body, account), { params: Promise.resolve({ id }) });
}
/** Alice asks Bob for 5 USDC; returns the request id. */
async function aliceAsksBob() {
  const { request: created } = await (await createRequest(request({ toUsername: "bob", amount: "5", note: "pizza" }))).json();
  return created.id as string;
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
    requests: [],
    transactions: [],
  };
});

test("creates a pending request from the verified caller", async () => {
  const response = await createRequest(request({ toUsername: " Bob ", amount: "12.5", note: "  dinner ", requester_id: C }));
  assert.equal(response.status, 200);
  assert.equal(tables.requests.length, 1);
  assert.deepEqual(
    { requester: tables.requests[0].requester_id, payer: tables.requests[0].payer_id, amount: tables.requests[0].amount, note: tables.requests[0].note, status: tables.requests[0].status },
    { requester: A, payer: B, amount: "12.5", note: "dinner", status: "pending" },
  );
});

test("invalid requests are rejected without writing", async () => {
  for (const body of [
    { toUsername: "alice", amount: "1" },
    { toUsername: "bob", amount: "0" },
    { toUsername: "bob", amount: "-1" },
    { toUsername: "bob", amount: "Infinity" },
    { toUsername: "bob", amount: "1e3" },
    { toUsername: "bob", amount: "1.1234567" },
    { toUsername: "bob", amount: "10000.01" },
    { toUsername: "bob", amount: "1", note: "x".repeat(141) },
    { toUsername: "bob", amount: "1", splitId: "not-a-uuid" },
    { toUsername: "b%", amount: "1" },
  ]) {
    assert.equal((await createRequest(request(body))).status, 400, JSON.stringify(body));
  }
  assert.equal((await createRequest(request({ toUsername: "nobody", amount: "1" }))).status, 404);
  assert.equal((await createRequest(request({ toUsername: "bob", amount: "1" }, "account-new"))).status, 409);
  assert.equal((await createRequest(request({ toUsername: "bob", amount: "1" }, "nope"))).status, 401);
  assert.equal(tables.requests.length, 0);
});

test("lists incoming and outgoing requests with usernames", async () => {
  await aliceAsksBob();
  const incoming = await (await listRequests(request(undefined, "account-b", "http://localhost/api/requests?tab=incoming"))).json();
  assert.equal(incoming.requests.length, 1);
  assert.equal(incoming.requests[0].requester_username, "alice");
  const outgoing = await (await listRequests(request(undefined, "account-b", "http://localhost/api/requests?tab=outgoing"))).json();
  assert.equal(outgoing.requests.length, 0);
  assert.equal((await listRequests(request(undefined, "account-a", "http://localhost/api/requests?tab=all"))).status, 400);
});

test("paying marks the request paid and records a linked transaction", async () => {
  const id = await aliceAsksBob();
  const response = await answer(id, { action: "pay", txHash: HASH });
  assert.equal(response.status, 200);
  assert.equal(tables.requests[0].status, "paid");
  assert.equal(tables.transactions.length, 1);
  const { from_user, to_user, amount, tx_hash, request_id, status } = tables.transactions[0];
  assert.deepEqual({ from_user, to_user, amount, tx_hash, request_id, status }, { from_user: B, to_user: A, amount: "5", tx_hash: HASH, request_id: id, status: "pending" });
});

test("paying links a transaction the send already recorded", async () => {
  const id = await aliceAsksBob();
  tables.transactions.push({ id: "tx-1", from_user: B, to_user: A, amount: "5", tx_hash: HASH, request_id: null, status: "pending" });
  assert.equal((await answer(id, { action: "pay", txHash: HASH })).status, 200);
  assert.equal(tables.transactions.length, 1);
  assert.equal(tables.transactions[0].request_id, id);
});

test("a mismatched transaction is refused and the request stays pending", async () => {
  const id = await aliceAsksBob();
  tables.transactions.push({ id: "tx-1", from_user: C, to_user: A, amount: "5", tx_hash: HASH, request_id: null, status: "pending" });
  assert.equal((await answer(id, { action: "pay", txHash: HASH })).status, 409);
  assert.equal(tables.requests[0].status, "pending");
});

test("a failed transaction write rolls the request back to pending", async () => {
  const id = await aliceAsksBob();
  failInsertInto = "transactions";
  const response = await answer(id, { action: "pay", txHash: HASH });
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /private database detail/);
  assert.equal(tables.requests[0].status, "pending");
});

test("only the payer can answer, and only once", async () => {
  const id = await aliceAsksBob();
  assert.equal((await answer(id, { action: "decline" }, "account-a")).status, 403);
  assert.equal((await answer(id, { action: "decline" }, "account-c")).status, 403);
  assert.equal((await answer(id, { action: "decline" })).status, 200);
  assert.equal(tables.requests[0].status, "declined");
  assert.equal((await answer(id, { action: "pay", txHash: OTHER_HASH })).status, 409);
  assert.equal(tables.transactions.length, 0);
});

test("bad answers are rejected", async () => {
  const id = await aliceAsksBob();
  assert.equal((await answer(id, { action: "pay" })).status, 400);
  assert.equal((await answer(id, { action: "pay", txHash: "0x123" })).status, 400);
  assert.equal((await answer(id, { action: "refund" })).status, 400);
  assert.equal((await answer("not-a-uuid", { action: "decline" })).status, 400);
  assert.equal((await answer("10000000-0000-4000-8000-0000000000ff", { action: "decline" })).status, 404);
  const malformed = new Request("http://localhost", { method: "POST", headers: { Authorization: "Bearer account-b" }, body: "{" });
  assert.equal((await answerRequest(malformed, { params: Promise.resolve({ id }) })).status, 400);
  assert.equal(tables.requests[0].status, "pending");
});
