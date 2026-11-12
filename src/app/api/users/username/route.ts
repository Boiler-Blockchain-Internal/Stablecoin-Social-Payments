import { UnauthorizedError, requirePrivyUser } from "@/lib/privy";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { isValidUsername, normalizeUsername, USERNAME_HELP } from "@/lib/username";

export async function POST(request: Request) {
  try {
    const privyId = await requirePrivyUser(request);
    let body: unknown;
    try { body = await request.json(); } catch {
      return Response.json({ error: "Send a valid JSON object." }, { status: 400 });
    }
    const value = body && typeof body === "object" && "username" in body ? body.username : null;
    const username = typeof value === "string" ? normalizeUsername(value) : null;
    if (!isValidUsername(username)) return Response.json({ error: USERNAME_HELP }, { status: 400 });

    const db = getSupabaseAdmin();
    // Exact match after validation: underscores must not act as ILIKE wildcards.
    // The lower(username) unique index also rejects legacy names differing by case.
    const availability = await db.from("users").select("id, privy_id, username, wallet_address, created_at").eq("username", username).limit(1);
    if (availability.error) throw availability.error;
    const holder = availability.data?.[0];
    // Already yours: a retry after a save whose response was lost (e.g. timed out) succeeds instead of trapping you.
    if (holder?.privy_id === privyId) return Response.json({ user: holder });
    if (holder) return Response.json({ error: "That username is already taken." }, { status: 409 });

    // Identity and first-time-only selection are enforced in the write itself.
    const { data, error } = await db.from("users")
      .update({ username }).eq("privy_id", privyId).is("username", null)
      .select("id, privy_id, username, wallet_address, created_at").maybeSingle();
    if (error?.code === "23505") return Response.json({ error: "That username is already taken." }, { status: 409 });
    if (error) throw error;
    if (!data) return Response.json({ error: "Profile missing or username already set. Refresh your profile and try again." }, { status: 409 });
    return Response.json({ user: data });
  } catch (error) {
    if (error instanceof UnauthorizedError) return Response.json({ error: error.message }, { status: 401 });
    return Response.json({ error: "Unable to save username. Please try again." }, { status: 500 });
  }
}
