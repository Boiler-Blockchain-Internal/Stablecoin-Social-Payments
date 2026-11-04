import { decodeEventLog, erc20Abi, isHash, type Address, type Hex } from "viem";
import { publicClient, USDC_ADDRESS, toUsdcUnits } from "@/lib/chain";
import { requirePrivyUser } from "@/lib/privy";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { RequestError, errorResponse, getCallerUser, readJsonObject } from "@/features/requests/server";
import { isUuid } from "@/features/requests/validation";

function containsExpectedTransfer(
  logs: readonly { address: Address; topics: readonly Hex[]; data: Hex }[],
  from: string,
  to: string,
  amount: string,
): boolean {
  let units: bigint;

  try {
    units = toUsdcUnits(amount);
  } catch {
    return false;
  }

  return logs.some((log) => {
    if (log.address.toLowerCase() !== USDC_ADDRESS.toLowerCase()) {
      return false;
    }

    if (log.topics.length === 0) {
      return false;
    }

    try {
      const event = decodeEventLog({
        abi: erc20Abi,
        data: log.data,
        topics: [log.topics[0], ...log.topics.slice(1)],
      });

      return (
        event.eventName === "Transfer" &&
        event.args.from.toLowerCase() === from.toLowerCase() &&
        event.args.to.toLowerCase() === to.toLowerCase() &&
        event.args.value === units
      );
    } catch {
      return false;
    }
  });
}



export async function POST(request: Request) {
  try {
    const caller = await getCallerUser(await requirePrivyUser(request));
    const body = await readJsonObject(request);
    if (typeof body.transactionId !== "string" || !isUuid(body.transactionId)) {
      throw new RequestError("Invalid transaction ID.", 400);
    }
    const db = getSupabaseAdmin();
    const lookup = await db.from("transactions")
      .select("id, from_user, to_user, amount, tx_hash, status")
      .eq("id", body.transactionId).maybeSingle();
    if (lookup.error) throw lookup.error;
    const tx = lookup.data;
    if (!tx || (tx.from_user !== caller.id && tx.to_user !== caller.id)) {
      throw new RequestError("Transaction not found.", 404);
    }
    if (tx.status !== "pending") return Response.json({ status: tx.status });
    if (!tx.tx_hash || !isHash(tx.tx_hash)) {
      throw new RequestError("This payment does not have a valid transaction hash.", 409);
    }
    let receipt;
    try {
      receipt = await publicClient.getTransactionReceipt({ hash: tx.tx_hash as Hex });
    } catch (e) {
      if (e instanceof Error && (e.name === "TransactionReceiptNotFoundError" || e.name === "TransactionNotFoundError")) {
        return Response.json({ status: "pending" });
      }
      throw e;
    }
    let next: "confirmed" | "failed";
    if (receipt.status === "reverted") {
      next = "failed";
    } else {
      const userIds = [tx.from_user, tx.to_user];
      const users = await db.from("users").select("id, wallet_address").in("id", userIds);
      if (users.error) throw users.error;
      const sender = users.data?.find((u) => u.id === tx.from_user)?.wallet_address;
      const recipient = users.data?.find((u) => u.id === tx.to_user)?.wallet_address;
      if (!sender || !recipient) throw new RequestError("Wallet information is incomplete.", 409);
      if (!containsExpectedTransfer(receipt.logs, sender, recipient, String(tx.amount))) {
        throw new RequestError("On-chain USDC transfer does not match the recorded payment.", 409);
      }
      next = "confirmed";
    }
    const updated = await db.from("transactions").update({ status: next })
      .eq("id", tx.id).eq("status", "pending").select("status").maybeSingle();
    if (updated.error) throw updated.error;
    return Response.json({ status: updated.data?.status ?? next });
  } catch (e) {
    return errorResponse(e, "Unable to verify transfer.");
  }
}
