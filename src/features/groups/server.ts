// SERVER ONLY. Shared helpers for the groups API routes. Never import from a "use client" file.
import { UnauthorizedError } from "@/lib/privy";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { toUsdcUnits } from "@/lib/chain";
import { isValidUsername, normalizeUsername } from "@/lib/username";
import { parseAmount } from "@/features/requests/validation";
import { splitEvenly, sumUnits, type Share } from "./splits";
import { GROUP_NAME_MAX, isUuid } from "./validation";

/** An expected failure with a message that is safe to show the user. */
export class GroupError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export type CallerUser = { id: string; username: string };

/** Turns any thrown error into a JSON response without leaking database details. */
export function errorResponse(error: unknown, fallback: string): Response {
  if (error instanceof UnauthorizedError) return Response.json({ error: error.message }, { status: 401 });
  if (error instanceof GroupError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: fallback }, { status: 500 });
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try { body = await request.json(); } catch {
    throw new GroupError("Send a valid JSON object.", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new GroupError("Send a valid JSON object.", 400);
  return body as Record<string, unknown>;
}

/** The verified caller's users row. Groups need a username, so onboarding must be finished. */
export async function getCallerUser(privyId: string): Promise<CallerUser> {
  const { data, error } = await getSupabaseAdmin()
    .from("users").select("id, username").eq("privy_id", privyId).maybeSingle();
  if (error) throw error;
  if (!data?.username) throw new GroupError("Finish setting up your profile first.", 409);
  return data;
}

export type GroupRow = { id: string; name: string; created_by: string | null };

export async function getGroup(id: string): Promise<GroupRow> {
  if (!isUuid(id)) throw new GroupError("That group link isn't valid.", 400);
  const { data, error } = await getSupabaseAdmin()
    .from("groups").select("id, name, created_by").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new GroupError("Group not found.", 404);
  return data;
}

export async function isMember(groupId: string, userId: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from("group_members").select("user_id").eq("group_id", groupId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data !== null;
}

export function parseGroupName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) throw new GroupError("Give your group a name.", 400);
  if (name.length > GROUP_NAME_MAX) throw new GroupError(`Group names can be at most ${GROUP_NAME_MAX} characters.`, 400);
  return name;
}

/** Validates a list of member usernames and returns their user ids. The caller is added separately. */
export async function resolveMembers(value: unknown, caller: CallerUser): Promise<string[]> {
  if (!Array.isArray(value)) throw new GroupError("Members must be a list of usernames.", 400);
  const usernames: string[] = [];
  for (const item of value) {
    const username = typeof item === "string" ? normalizeUsername(item) : null;
    if (!isValidUsername(username)) throw new GroupError("Each member must be a valid username.", 400);
    if (usernames.includes(username)) throw new GroupError(`@${username} is listed more than once.`, 400);
    if (username === caller.username) throw new GroupError("You're added to your own group automatically.", 400);
    usernames.push(username);
  }
  if (usernames.length === 0) return [];

  // Exact match after validation, so underscores can't act as wildcards.
  const { data, error } = await getSupabaseAdmin().from("users").select("id, username").in("username", usernames);
  if (error) throw error;
  const found = new Map((data ?? []).map((user: CallerUser) => [user.username, user.id]));
  const missing = usernames.filter((username) => !found.has(username));
  if (missing.length) throw new GroupError(`No user found for ${missing.map((u) => `@${u}`).join(", ")}.`, 404);
  return usernames.map((username) => found.get(username)!);
}

/** Works out each member's share of a bill. memberIds must come from the database, not the client. */
export function parseBillShares(body: Record<string, unknown>, totalUnits: bigint, memberIds: string[]): Share[] {
  if (body.mode === "even") {
    const shares = splitEvenly(totalUnits, memberIds);
    if (shares.some((share) => share.units === BigInt(0))) throw new GroupError("That total is too small to split.", 400);
    return shares;
  }
  if (body.mode !== "custom") throw new GroupError("Choose an even or custom split.", 400);
  if (!Array.isArray(body.shares)) throw new GroupError("Custom splits need an amount for each person.", 400);

  const shares: Share[] = [];
  for (const item of body.shares as unknown[]) {
    const { userId, amount } = (item ?? {}) as { userId?: unknown; amount?: unknown };
    if (typeof userId !== "string" || !memberIds.includes(userId)) throw new GroupError("Everyone in a split must be in this group.", 400);
    if (shares.some((share) => share.userId === userId)) throw new GroupError("Each person can only have one amount.", 400);
    const parsed = parseAmount(amount);
    if (!parsed) throw new GroupError("Enter a valid amount for each person, or leave it blank.", 400);
    shares.push({ userId, units: toUsdcUnits(parsed) });
  }
  if (sumUnits(shares.map((share) => share.units)) !== totalUnits) throw new GroupError("The amounts must add up to the total.", 400);
  return shares;
}
