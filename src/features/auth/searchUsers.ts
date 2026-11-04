import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { normalizeUsername } from "@/lib/username";

/** Public recipient identity; never include email, Privy ID, or wallet details. */
export type SelectedUser = { id: string; username: string };
export const USER_SEARCH_LIMIT = 8;

export async function searchUsers(input: string, ownPrivyId: string, signal: AbortSignal): Promise<SelectedUser[]> {
  const query = normalizeUsername(input);
  if (!/^[a-z0-9_]{1,20}$/.test(query)) return [];
  // Escape LIKE's underscore wildcard; percent and backslash fail validation above.
  const pattern = `%${query.replace(/_/g, "\\_")}%`;
  const { data, error } = await getSupabaseBrowser().from("users")
    .select("id, username")
    .ilike("username", pattern)
    .neq("privy_id", ownPrivyId)
    .order("username").order("id")
    .limit(USER_SEARCH_LIMIT).abortSignal(signal);
  if (error) throw new Error("Unable to search users. Please try again.");
  const unique = new Map<string, SelectedUser>();
  for (const row of data ?? []) {
    if (typeof row.id === "string" && typeof row.username === "string" && row.username) {
      unique.set(row.id, { id: row.id, username: row.username });
    }
  }
  return [...unique.values()];
}
