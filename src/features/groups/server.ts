// SERVER ONLY. Shared helpers for the groups API routes. Never import from a "use client" file.
import { UnauthorizedError } from "@/lib/privy";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { isValidUsername, normalizeUsername } from "@/lib/username";
import { GROUP_NAME_MAX } from "./validation";

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
