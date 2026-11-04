import { requirePrivyUser } from "@/lib/privy";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { isValidUsername, normalizeUsername } from "@/lib/username";
import { RequestError, errorResponse, getCallerUser, readJsonObject } from "@/features/requests/server";
import { AMOUNT_MAX, NOTE_MAX, isUuid, parseAmount } from "@/features/requests/validation";

const REQUEST_COLUMNS = "id, requester_id, payer_id, amount, note, status, split_id, created_at";

export async function POST(request: Request) {
  try {
    const caller = await getCallerUser(await requirePrivyUser(request));
    const body = await readJsonObject(request);

    const toUsername = typeof body.toUsername === "string" ? normalizeUsername(body.toUsername) : null;
    if (!isValidUsername(toUsername)) throw new RequestError("Pick who should pay you.", 400);
    if (toUsername === caller.username) throw new RequestError("You can't request money from yourself.", 400);

    const amount = parseAmount(body.amount);
    if (!amount) throw new RequestError(`Enter an amount between 0 and ${AMOUNT_MAX} USDC, with at most 6 decimals.`, 400);

    const note = typeof body.note === "string" ? body.note.trim() || null : null;
    if (note && note.length > NOTE_MAX) throw new RequestError(`Notes can be at most ${NOTE_MAX} characters.`, 400);

    const splitId = body.splitId ?? null;
    if (splitId !== null && (typeof splitId !== "string" || !isUuid(splitId))) throw new RequestError("That split isn't valid.", 400);

    const db = getSupabaseAdmin();
    // Exact match after validation, so underscores can't act as wildcards.
    const payerRes = await db.from("users").select("id").eq("username", toUsername).maybeSingle();
    if (payerRes.error) throw payerRes.error;
    if (!payerRes.data) throw new RequestError(`No user found for @${toUsername}.`, 404);

    const { data, error } = await db.from("requests").insert({
      requester_id: caller.id,
      payer_id: payerRes.data.id,
      amount,
      note,
      status: "pending",
      split_id: splitId,
    }).select(REQUEST_COLUMNS).single();
    if (error) throw error;
    return Response.json({ request: data });
  } catch (e) {
    return errorResponse(e, "Unable to create request.");
  }
}

export async function GET(request: Request) {
  try {
    const caller = await getCallerUser(await requirePrivyUser(request));
    const tab = new URL(request.url).searchParams.get("tab") ?? "incoming";
    if (tab !== "incoming" && tab !== "outgoing") throw new RequestError("Unknown tab.", 400);

    const db = getSupabaseAdmin();
    const { data: requests, error } = await db.from("requests").select(REQUEST_COLUMNS)
      .eq(tab === "incoming" ? "payer_id" : "requester_id", caller.id)
      .order("created_at", { ascending: false });
    if (error) throw error;

    // Attach usernames so the inbox can show them and Pay knows who to send to.
    const userIds = [...new Set((requests ?? []).flatMap((r) => [r.requester_id, r.payer_id]).filter(Boolean))];
    const usernames: Record<string, string | null> = {};
    if (userIds.length > 0) {
      const { data: users, error: usersError } = await db.from("users").select("id, username").in("id", userIds);
      if (usersError) throw usersError;
      for (const u of users ?? []) usernames[u.id] = u.username;
    }

    return Response.json({
      requests: (requests ?? []).map((r) => ({
        ...r,
        requester_username: usernames[r.requester_id] ?? null,
        payer_username: usernames[r.payer_id] ?? null,
      })),
    });
  } catch (e) {
    return errorResponse(e, "Unable to fetch requests.");
  }
}
