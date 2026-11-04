import { requirePrivyUser } from "@/lib/privy";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { RequestError, errorResponse, getCallerUser, readJsonObject } from "@/features/requests/server";
import { isTxHash, isUuid } from "@/features/requests/validation";

type RequestRow = { id: string; requester_id: string; payer_id: string; amount: string; note: string | null; status: string };

/**
 * The payer answers a pending request.
 * - { action: "decline" }
 * - { action: "pay", txHash }: call after sendUSDC() succeeds. Marks the request paid and links the
 *   payment: an existing `transactions` row with that hash gets `request_id`, otherwise one is recorded.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const caller = await getCallerUser(await requirePrivyUser(request));
    if (!isUuid(id)) throw new RequestError("That request link isn't valid.", 400);
    const body = await readJsonObject(request);
    const action = body.action;
    if (action !== "pay" && action !== "decline") throw new RequestError("Invalid action.", 400);
    const txHash = action === "pay" ? body.txHash : null;
    if (action === "pay" && !isTxHash(txHash)) throw new RequestError("Paying needs the transfer's transaction hash.", 400);

    const db = getSupabaseAdmin();
    const found = await db.from("requests").select("id, requester_id, payer_id, amount, note, status").eq("id", id).maybeSingle();
    if (found.error) throw found.error;
    const row = found.data as RequestRow | null;
    if (!row) throw new RequestError("Request not found.", 404);
    if (row.payer_id !== caller.id) throw new RequestError("Only the person asked to pay can answer this request.", 403);
    if (row.status !== "pending") throw new RequestError("This request was already answered.", 409);

    // Only a still-pending row changes, so a double click or a pay/decline race can't both win.
    const claimed = await db.from("requests").update({ status: action === "pay" ? "paid" : "declined" })
      .eq("id", id).eq("status", "pending").select("id").maybeSingle();
    if (claimed.error) throw claimed.error;
    if (!claimed.data) throw new RequestError("This request was already answered.", 409);

    if (action === "pay") {
      try {
        await linkPayment(row, txHash as string);
      } catch (e) {
        await db.from("requests").update({ status: "pending" }).eq("id", id);
        throw e;
      }
    }
    return Response.json({ status: action === "pay" ? "paid" : "declined" });
  } catch (e) {
    return errorResponse(e, "Unable to update request.");
  }
}

async function linkPayment(row: RequestRow, txHash: string) {
  const db = getSupabaseAdmin();
  const existing = await db.from("transactions").select("id, from_user, to_user, request_id").eq("tx_hash", txHash).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    const tx = existing.data;
    if (tx.from_user !== row.payer_id || tx.to_user !== row.requester_id || tx.request_id) {
      throw new RequestError("That transaction doesn't match this request.", 409);
    }
    const { error } = await db.from("transactions").update({ request_id: row.id }).eq("id", tx.id);
    if (error) throw error;
    return;
  }
  const { error } = await db.from("transactions").insert({
    from_user: row.payer_id,
    to_user: row.requester_id,
    amount: row.amount,
    note: row.note,
    tx_hash: txHash,
    status: "pending",
    request_id: row.id,
  });
  if (error) throw error;
}
