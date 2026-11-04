// SERVER ONLY. Shared helpers for the requests API routes. Never import from a "use client" file.
import { UnauthorizedError } from "@/lib/privy";
import { getSupabaseAdmin } from "@/lib/supabase-server";

/** An expected failure with a message that is safe to show the user. */
export class RequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Turns any thrown error into a JSON response without leaking database details. */
export function errorResponse(error: unknown, fallback: string): Response {
  if (error instanceof UnauthorizedError) return Response.json({ error: error.message }, { status: 401 });
  if (error instanceof RequestError) return Response.json({ error: error.message }, { status: error.status });
  console.error(fallback, error);
  return Response.json({ error: fallback }, { status: 500 });
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try { body = await request.json(); } catch {
    throw new RequestError("Send a valid JSON object.", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new RequestError("Send a valid JSON object.", 400);
  return body as Record<string, unknown>;
}

export type CallerUser = { id: string; username: string };

/** The verified caller's users row. Requests need a username, so onboarding must be finished. */
export async function getCallerUser(privyId: string): Promise<CallerUser> {
  const { data, error } = await getSupabaseAdmin()
    .from("users").select("id, username").eq("privy_id", privyId).maybeSingle();
  if (error) throw error;
  if (!data?.username) throw new RequestError("Finish setting up your profile first.", 409);
  return data;
}
