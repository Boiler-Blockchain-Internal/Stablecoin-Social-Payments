// Shared by the browser form and the API routes.
export const NOTE_MAX = 140;
export const AMOUNT_MAX = 10_000;

/** USDC has 6 decimals, so amounts are plain decimals with at most 6 places. */
export function parseAmount(value: unknown): string | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d+(\.\d{1,6})?$/.test(text)) return null;
  const amount = Number(text);
  return amount > 0 && amount <= AMOUNT_MAX ? text : null;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function isTxHash(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);
}
