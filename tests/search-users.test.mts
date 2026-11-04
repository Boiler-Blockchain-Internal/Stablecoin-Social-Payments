import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";

const calls: [string, ...unknown[]][] = [];
let data: unknown[] = [];
let error: unknown = null;
mock.module("../src/lib/supabase-browser.ts", { namedExports: {
  getSupabaseBrowser: () => ({ from: (table: string) => {
    calls.push(["from", table]);
    const builder: Record<string, (...args: unknown[]) => unknown> = Object.fromEntries(["select", "ilike", "neq", "order", "limit"].map((name) => [name, (...args: unknown[]) => { calls.push([name, ...args]); return builder; }]));
    builder.abortSignal = async (signal: unknown) => { calls.push(["abortSignal", signal]); return { data, error }; };
    return builder;
  } }),
} });
const { searchUsers } = await import("../src/features/auth/searchUsers");
beforeEach(() => { calls.length = 0; data = []; error = null; });
test("substring search is normalized, bounded, literal, and minimally projected", async () => {
  const signal = new AbortController().signal;
  data = [{ id: "1", username: "alice_one", email: "private", wallet_address: "secret" }, { id: "1", username: "alice_one" }, { id: "2", username: null }];
  assert.deepEqual(await searchUsers("  ALIce_ ", "did:privy:self", signal), [{ id: "1", username: "alice_one" }]);
  assert.deepEqual(calls, [["from", "users"], ["select", "id, username"], ["ilike", "username", "%alice\\_%"], ["neq", "privy_id", "did:privy:self"], ["order", "username"], ["order", "id"], ["limit", 8], ["abortSignal", signal]]);
});
test("invalid or empty searches never query the database", async () => {
  for (const query of ["", " ", "%", "a b", "a\\b", "a".repeat(21)]) assert.deepEqual(await searchUsers(query, "self", new AbortController().signal), []);
  assert.equal(calls.length, 0);
});
test("no matches returns an empty result", async () => {
  assert.deepEqual(await searchUsers("missing", "self", new AbortController().signal), []);
});
test("database details never escape into UI errors", async () => {
  error = { message: "secret database detail" };
  await assert.rejects(searchUsers("alice", "self", new AbortController().signal), { message: "Unable to search users. Please try again." });
});
