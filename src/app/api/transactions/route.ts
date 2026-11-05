import { requirePrivyUser } from "@/lib/privy";
import { getOpenPaymentForCaller, preparePayment, readSendBody, sendErrorResponse } from "@/features/send/server";

/** Look up the caller's single pending send so a lost browser recovery record can be restored. */
export async function GET(request: Request) {
  try {
    const privyId = await requirePrivyUser(request);
    const payment = await getOpenPaymentForCaller(privyId);
    return Response.json(payment ?? { payment: null });
  } catch (error) {
    return sendErrorResponse(error, "Unable to check for a pending payment.");
  }
}

/** Create an authenticated, idempotent pending intent before the wallet is asked to transfer. */
export async function POST(request: Request) {
  try {
    const privyId = await requirePrivyUser(request);
    const body = await readSendBody(request);
    if (body.action !== "prepare") return Response.json({ error: "Invalid transaction action." }, { status: 400 });
    const prepared = await preparePayment(privyId, body);
    return Response.json(prepared, { status: prepared.created ? 201 : 200 });
  } catch (error) {
    return sendErrorResponse(error, "Unable to prepare this payment.");
  }
}
