import assert from "node:assert/strict";
import { test } from "node:test";
import { filterActivity } from "../src/features/history/filter.ts";
import type { ActivityItem } from "../src/features/history/types";

const items: ActivityItem[] = [
  { kind: "transaction", id: "t1", fromUser: "me", toUser: "alex", fromUsername: "me", toUsername: "alex", amount: "5", note: null, status: "confirmed", txHash: null, requestId: null, groupId: "g1", createdAt: "2026-11-01T00:00:00Z" },
  { kind: "transaction", id: "t2", fromUser: "sam", toUser: "me", fromUsername: "sam", toUsername: "me", amount: "7", note: null, status: "pending", txHash: null, requestId: null, groupId: null, createdAt: "2026-11-02T00:00:00Z" },
  { kind: "request", id: "r1", requesterId: "alex", payerId: "me", requesterUsername: "alex", payerUsername: "me", amount: "3", note: null, status: "pending", groupId: "g1", createdAt: "2026-11-03T00:00:00Z" },
];

test("all activity includes pending requests", () => assert.equal(filterActivity(items, "me", "all", "", "").length, 3));
test("pending filters pending transfers and requests", () => assert.deepEqual(filterActivity(items, "me", "pending", "", "").map((x) => x.id), ["t2", "r1"]));
test("person filter matches counterparty", () => assert.deepEqual(filterActivity(items, "me", "all", "alex", "").map((x) => x.id), ["t1", "r1"]));
test("group filter only matches group-associated activity", () => assert.deepEqual(filterActivity(items, "me", "all", "", "g1").map((x) => x.id), ["t1", "r1"]));
test("direction separates sent and received", () => {
  assert.deepEqual(filterActivity(items, "me", "sent", "", "").map((x) => x.id), ["t1", "r1"]);
  assert.deepEqual(filterActivity(items, "me", "received", "", "").map((x) => x.id), ["t2"]);
});
