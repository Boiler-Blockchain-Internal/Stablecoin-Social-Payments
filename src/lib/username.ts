export const USERNAME_HELP = "Use 3–20 letters, numbers, or underscores.";
export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}
export function isValidUsername(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9_]{3,20}$/.test(value);
}
