import type { AppUser } from "./useSyncUser";

export const PROFILE_REQUEST_TIMEOUT_MS = 15000;

export class ProfileRequestError extends Error {
  constructor(message: string, public readonly retryable = true) { super(message); }
}

function isAppUser(value: unknown): value is AppUser {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && !!row.id && typeof row.privy_id === "string" && !!row.privy_id
    && (row.username === null || typeof row.username === "string")
    && (row.wallet_address === null || typeof row.wallet_address === "string")
    && typeof row.created_at === "string";
}

/** Bound the entire existing API request, including response-body parsing. */
export async function requestProfile(path: "/api/users/sync" | "/api/users/username", token: string, signal: AbortSignal, username?: string): Promise<AppUser> {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener("abort", cancel, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; cancel(); }, PROFILE_REQUEST_TIMEOUT_MS);
  const fallback = path.endsWith("username")
    ? "Unable to save your username. Check your connection and try again."
    : "Unable to sync your profile. Check your connection and try again.";
  try {
    const response = await fetch(path, {
      method: "POST", signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, ...(username !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(username !== undefined ? { body: JSON.stringify({ username }) } : {}),
    });
    if (response.status === 401) throw new ProfileRequestError("Session expired. Please log in again.", false);
    // A non-JSON body (e.g. a proxy's HTML error page) must not hide the status code's meaning.
    const body = await response.json().catch(() => null);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (timedOut) throw new ProfileRequestError("That request took too long. Please try again.");
    if (!response.ok) throw new ProfileRequestError(typeof body?.error === "string" ? body.error : fallback, response.status >= 500 || response.status === 429);
    if (!isAppUser(body?.user)) throw new ProfileRequestError("The profile response was incomplete. Please try again.");
    return body.user;
  } catch (error) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (timedOut) throw new ProfileRequestError("That request took too long. Please try again.");
    if (error instanceof ProfileRequestError) throw error;
    throw new ProfileRequestError(fallback);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", cancel);
  }
}
