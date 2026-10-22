import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import { isValidUsername, normalizeUsername } from "../src/lib/username";
import { requirePrivyUser as realRequirePrivyUser, UnauthorizedError } from "../src/lib/privy";

type Row = { id: string; privy_id: string; username: string | null; wallet_address: string | null };
let rows: Row[] = [];
let failDatabase = false;
let failWallet = false;
let wallet: string | null = "0xABC";

// Controlled SDK boundary: execute the real route handlers against a deterministic store.
// Live PostgreSQL uniqueness and Privy cryptography need separate integration verification.
mock.module("../src/lib/privy.ts", { namedExports: {
  UnauthorizedError,
  requirePrivyUser: async (request: Request) => {
    const token = request.headers.get("authorization");
    if (!token?.startsWith("Bearer account-")) throw new UnauthorizedError("Invalid token");
    return token.slice(7);
  },
  getSmartWalletAddress: async () => {
    if (failWallet) throw new Error("private upstream detail");
    return wallet;
  },
} });

mock.module("../src/lib/supabase-server.ts", { namedExports: {
  getSupabaseAdmin: () => ({ from: (table: string) => {
    assert.equal(table, "users");
    let operation = "select";
    let values: Partial<Row> = {};
    const filters: Record<string, unknown> = {};
    function execute() {
      if (failDatabase) return { data: null, error: { message: "private database detail" } };
      if (operation === "upsert") {
        let row = rows.find((r) => r.privy_id === values.privy_id);
        if (!row) { row = { id: String(rows.length), privy_id: values.privy_id!, username: null, wallet_address: null }; rows.push(row); }
        Object.assign(row, values);
        return { data: { ...row }, error: null };
      }
      const matching = rows.filter((r) => Object.entries(filters).every(([key, value]) => r[key as keyof Row] === value));
      if (operation === "update" && matching[0]) {
        if (rows.some((r) => r.username?.toLowerCase() === values.username)) return { data: null, error: { code: "23505" } };
        Object.assign(matching[0], values);
      }
      return { data: matching[0] ? { ...matching[0] } : null, error: null };
    }
    const query = {
      select: () => query,
      upsert: (input: Partial<Row>, options: { onConflict: string }) => { assert.equal(options.onConflict, "privy_id"); operation = "upsert"; values = input; return query; },
      update: (input: Partial<Row>) => { operation = "update"; values = input; return query; },
      eq: (key: string, value: unknown) => { filters[key] = value; return query; },
      is: (key: string, value: unknown) => { filters[key] = value; return query; },
      limit: async () => { const result = execute(); return { ...result, data: result.data ? [result.data] : [] }; },
      single: async () => execute(),
      maybeSingle: async () => execute(),
    };
    return query;
  } }),
} });

const { POST: sync } = await import("../src/app/api/users/sync/route");
const { POST: choose } = await import("../src/app/api/users/username/route");
function request(body: unknown = {}, account = "account-a") {
  return new Request("http://localhost/api/users", { method: "POST", headers: { Authorization: `Bearer ${account}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
beforeEach(() => { rows = []; failDatabase = false; failWallet = false; wallet = "0xABC"; });

test("username validation and normalization", () => {
  assert.equal(normalizeUsername("  Rithvik_1  "), "rithvik_1");
  for (const value of ["abc", "rithvik_1", "a".repeat(20)]) assert.ok(isValidUsername(value));
  for (const value of [null, 123, "ab", "a".repeat(21), "a b", "a-b", "ééé", "ABC", "abc\n"]) assert.equal(isValidUsername(value), false);
});
test("new login persists without a wallet; repeated login preserves profile", async () => {
  wallet = null;
  assert.equal((await sync(request({ privy_id: "victim" }))).status, 200);
  assert.equal(rows[0].privy_id, "account-a");
  assert.equal(rows[0].wallet_address, null);
  rows[0].username = "existing";
  wallet = "0xABC";
  await sync(request());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].username, "existing");
  assert.equal(rows[0].wallet_address, "0xabc");
});
test("only verified user's unset username can be claimed", async () => {
  await sync(request());
  await sync(request({}, "account-b"));
  const response = await choose(request({ username: "  Rithvik_1 ", privy_id: "account-b", id: rows[1].id }));
  assert.equal(response.status, 200);
  assert.equal(rows[0].username, "rithvik_1");
  assert.equal(rows[1].username, null);
  assert.equal((await choose(request({ username: "replacement" }))).status, 409);
  assert.equal(rows[0].username, "rithvik_1");
});
test("invalid input, malformed JSON, and missing profiles are rejected", async () => {
  for (const username of [null, "ab", "a b", "a".repeat(21), 42]) assert.equal((await choose(request({ username }))).status, 400);
  assert.equal((await choose(new Request("http://localhost", { method: "POST", headers: { Authorization: "Bearer account-a" }, body: "{" }))).status, 400);
  assert.equal((await choose(request({ username: "valid" }))).status, 409);
});
test("duplicate names and case variants return conflict", async () => {
  await sync(request());
  await sync(request({}, "account-b"));
  rows[1].username = "Taken";
  assert.equal((await choose(request({ username: "TAKEN" }))).status, 409);
  rows[1].username = "taken";
  assert.equal((await choose(request({ username: "taken" }))).status, 409);
});
test("concurrent claims produce one success at the database boundary", async () => {
  await sync(request()); await sync(request({}, "account-b"));
  const responses = await Promise.all([choose(request({ username: "same" })), choose(request({ username: "same" }, "account-b"))]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
});
test("authentication failures stop writes", async () => {
  for (const handler of [sync, choose]) assert.equal((await handler(request({ username: "valid" }, "invalid"))).status, 401);
  await assert.rejects(realRequirePrivyUser(new Request("http://localhost")), UnauthorizedError);
  assert.equal(rows.length, 0);
});
test("database and upstream errors are safe and recoverable", async () => {
  failDatabase = true;
  for (const response of [await sync(request()), await choose(request({ username: "valid" }))]) {
    assert.equal(response.status, 500);
    assert.doesNotMatch(await response.text(), /private/);
  }
  failDatabase = false; failWallet = true;
  assert.equal((await sync(request())).status, 500);
  failWallet = false;
  assert.equal((await sync(request())).status, 200);
});
