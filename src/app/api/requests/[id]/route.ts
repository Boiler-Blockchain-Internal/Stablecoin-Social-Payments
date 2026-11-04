import { UnauthorizedError, requirePrivyUser } from "@/lib/privy";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const privyId = await requirePrivyUser(request);
    const db = getSupabaseAdmin();

    const userRes = await db.from("users").select("id").eq("privy_id", privyId).single();
    if (userRes.error || !userRes.data) return Response.json({ error: "Profile not found." }, { status: 404 });
    const userId = userRes.data.id;

    const reqRes = await db.from("requests").select("id, payer_id, requester_id, amount, status").eq("id", id).single();
    if (reqRes.error || !reqRes.data) return Response.json({ error: "Request not found." }, { status: 404 });

    // Only payer can pay/decline
    if (reqRes.data.payer_id !== userId) return Response.json({ error: "Not authorized." }, { status: 403 });
    if (reqRes.data.status !== "pending") return Response.json({ error: "Request already handled." }, { status: 409 });

    const { action } = await request.json();
    if (action === "pay") {
      // Call shared sendUSDC — it takes toUsername, amount, note. We resolve payer username and requester username.
      // To keep route simple, update status only (UI handles sendUSDC call separately per requirement).
      // But requirement says Pay calls shared sendUSDC and updates status to paid.
      // We'll do the update here; sendUSDC is called from client.
      const { error } = await db.from("requests").update({ status: "paid" }).eq("id", id);
      if (error) throw error;
      return Response.json({ success: true, status: "paid" });
    }
    if (action === "decline") {
      const { error } = await db.from("requests").update({ status: "declined" }).eq("id", id);
      if (error) throw error;
      return Response.json({ success: true, status: "declined" });
    }
    return Response.json({ error: "Invalid action." }, { status: 400 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return Response.json({ error: e.message }, { status: 401 });
    return Response.json({ error: "Unable to update request." }, { status: 500 });
  }
}
