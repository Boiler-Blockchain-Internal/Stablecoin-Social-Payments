import { requirePrivyUser } from "@/lib/privy";
import { cancelUnsubmittedPayment, getPaymentForCaller, readSendBody, recordPaymentHash, sendErrorResponse } from "@/features/send/server";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const privyId = await requirePrivyUser(request);
    const { id } = await params;
    const payment = await getPaymentForCaller(privyId, id);
    return Response.json({ payment });
  } catch (error) {
    return sendErrorResponse(error, "Unable to load this payment.");
  }
}

/** Attach a client-reported hash only after independently verifying Base Sepolia evidence. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const privyId = await requirePrivyUser(request);
    const { id } = await params;
    const body = await readSendBody(request);
    if (body.action === "cancel") {
      const result = await cancelUnsubmittedPayment(privyId, id);
      return Response.json(result);
    }
    const result = await recordPaymentHash(privyId, id, body.txHash);
    return Response.json(result, { status: result.retry ? 202 : 200 });
  } catch (error) {
    return sendErrorResponse(error, "Unable to record this payment.");
  }
}
