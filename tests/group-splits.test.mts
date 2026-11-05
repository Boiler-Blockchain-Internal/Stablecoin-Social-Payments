import assert from "node:assert/strict";
import { test } from "node:test";
import { splitEvenly, sumUnits } from "../src/features/groups/splits";

const units = (shares: { units: bigint }[]) => shares.map((share) => share.units);

test("an exact division gives everyone the same share", () => {
  assert.deepEqual(units(splitEvenly(BigInt(9), ["a", "b", "c"])), [BigInt(3), BigInt(3), BigInt(3)]);
});

test("leftover units go one each to the first members by id", () => {
  const shares = splitEvenly(BigInt(10_000_000), ["c", "a", "b"]);
  assert.deepEqual(shares, [
    { userId: "a", units: BigInt(3_333_334) },
    { userId: "b", units: BigInt(3_333_333) },
    { userId: "c", units: BigInt(3_333_333) },
  ]);
});

test("shares always add up to the total", () => {
  for (const total of [1, 2, 7, 100, 999_999, 10_000_000_001]) {
    for (const count of [1, 2, 3, 7, 13]) {
      const ids = Array.from({ length: count }, (_, index) => `user-${index}`);
      assert.equal(sumUnits(units(splitEvenly(BigInt(total), ids))), BigInt(total));
    }
  }
});

test("member order doesn't change who gets what", () => {
  assert.deepEqual(splitEvenly(BigInt(5), ["b", "a"]), splitEvenly(BigInt(5), ["a", "b"]));
});

test("no members means no shares", () => {
  assert.deepEqual(splitEvenly(BigInt(5), []), []);
});

test("sumUnits of nothing is zero", () => {
  assert.equal(sumUnits([]), BigInt(0));
});
