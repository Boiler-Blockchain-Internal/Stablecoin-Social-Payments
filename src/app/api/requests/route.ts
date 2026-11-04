import { UnauthorizedError, requirePrivyUser } from "@/lib/privy";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { normalizeUsername } from "@/lib/username";

export async function POST(request: Request) {
  try {
    const privyId = await requirePrivyUser(request);
    let body: unknown;
    try { body = await request.json(); } catch {
      return Response.json({ error: "Send a valid JSON object." }, { status: 400 });
    }
    const value = body && typeof body === "object" && "toUsername" in body ? body.toUsername : null;
    const toUsername = typeof value === "string" ? normalizeUsername(value) : null;
    if (!toUsername) return Response.json({ error: "toUsername required." }, { status: 400 });

    const amountValue = body && typeof body === "object" && "amount" in body ? body.amount : null;
    const amount = typeof amountValue === "string" || typeof amountValue === "number" ? String(amountValue) : null;
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return Response.json({ error: "amount must be positive." }, { status: 400 });

    const noteValue = body && typeof body === "object" && "note" in body ? body.note : null;
    const note = typeof noteValue === "string" ? noteValue : null;

    const db = getSupabaseAdmin();

    // Resolve requester from verified caller
    const requesterRes = await db.from("users").select("id").eq("privy_id", privyId).single();
    if (requesterRes.error || !requesterRes.data) throw new Error("Requester profile not found.");
    const requesterId = requesterRes.data.id;

    // Resolve payer by username
    const payerRes = await db.from("users").select("id").eq("username", toUsername).single();
    if (payerRes.error || !payerRes.data) return Response.json({ error: "User not found." }, { status: 404 });
    const payerId = payerRes.data.id;

    const { data, error } = await db.from("requests").insert({
      requester_id: requesterId,
      payer_id: payerId,
      amount: amount,
      note,
      status: "pending",
    }).select("id, requester_id, payer_id, amount, note, status, split_id, created_at").single();

    if (error) throw error;
    return Response.json({ request: data });
  } catch (e) {
    if (e instanceof UnauthorizedError) return Response.json({ error: e.message }, { status: 401 });
    console.error("POST /api/requests error:", e);
    return Response.json({ error: "Unable to create request." }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const privyId = await requirePrivyUser(request);
    const db = getSupabaseAdmin();

    const userRes = await db.from("users").select("id").eq("privy_id", privyId).single();
    if (userRes.error || !userRes.data) return Response.json({ error: "Profile not found." }, { status: 404 });
    const userId = userRes.data.id;

    const url = new URL(request.url);
    const tab = url.searchParams.get("tab") || "incoming";

    // Fetch requests cleanly without ambiguous join hints
    let query = db.from("requests").select("id, requester_id, payer_id, amount, note, status, split_id, created_at").order("created_at", { ascending: false });

    if (tab === "incoming") {
      query = query.eq("payer_id", userId);
    } else if (tab === "outgoing") {
      query = query.eq("requester_id", userId);
    }

    const { data: requests, error } = await query;
    if (error) throw error;

    // Optionally fetch user profiles to attach usernames if needed by frontend
    const userIds = new Set<string>();
    requests?.forEach(r => {
      if (r.requester_id) userIds.add(r.requester_id);
      if (r.payer_id) userIds.add(r.payer_id);
    });

    let userMap: Record<string, { username: string }> = {};
    if (userIds.size > 0) {
      const { data: usersData } = await db.from("users").select("id, username").in("id", Array.from(userIds));
      if (usersData) {
        userMap = Object.fromEntries(usersData.map(u => [u.id, { username: u.username }]));
      }
    }

    const formattedRequests = requests?.map(r => ({
      ...r,
      users: {
        requester: userMap[r.requester_id] || { username: "unknown" },
        payer: userMap[r.payer_id] || { username: "unknown" }
      }
    }));

    return Response.json({ requests: formattedRequests ?? [] });
  } catch (e) {
    if (e instanceof UnauthorizedError) return Response.json({ error: e.message }, { status: 401 });
    console.error("GET /api/requests error:", e);
    return Response.json({ error: "Unable to fetch requests." }, { status: 500 });
  }
}