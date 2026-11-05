// Shared by the browser form and the API route. Amounts are USDC base units, so shares add up exactly.
export type Share = { userId: string; units: bigint };

/**
 * Divides a total across members. Leftover units go one each to the first members by id,
 * so the browser preview and the server always agree.
 */
export function splitEvenly(totalUnits: bigint, userIds: string[]): Share[] {
  if (userIds.length === 0) return [];
  const count = BigInt(userIds.length);
  const base = totalUnits / count;
  const leftover = totalUnits % count;
  return [...userIds].sort().map((userId, index) => ({
    userId,
    units: BigInt(index) < leftover ? base + BigInt(1) : base,
  }));
}

export function sumUnits(units: bigint[]): bigint {
  return units.reduce((sum, value) => sum + value, BigInt(0));
}
