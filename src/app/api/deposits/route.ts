import { requirePrivyUser } from "@/lib/privy";
import { DepositError, depositErrorResponse, listDeposits, progressDeposit } from "@/features/deposits/server";

/** The caller's recent deposits, so an unfinished one can be resumed on any device. */
export async function GET(request: Request) {
  try {
    const deposits = await listDeposits(await requirePrivyUser(request));
    return Response.json({ deposits }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return depositErrorResponse(error, "Unable to load deposits.");
  }
}

/** Record a verified burn and report the next step: wait, mint, or done. Safe to call repeatedly. */
export async function POST(request: Request) {
  try {
    const privyId = await requirePrivyUser(request);
    let body: unknown;
    try { body = await request.json(); } catch { throw new DepositError("Send a valid JSON object.", 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new DepositError("Send a valid JSON object.", 400);
    const progress = await progressDeposit(privyId, body as Record<string, unknown>);
    return Response.json(progress, { status: progress.status === "burning" ? 202 : 200 });
  } catch (error) {
    return depositErrorResponse(error, "Unable to check this deposit.");
  }
}
