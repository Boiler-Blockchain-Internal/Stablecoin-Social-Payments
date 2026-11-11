import { NextResponse } from "next/server";
import { isHash } from "viem";
import { requirePrivyUser } from "@/lib/privy";
import { DEPOSIT_CHAINS, type DepositChain } from "@/features/deposits/cctp";

export async function GET(request: Request) {
  try {
    await requirePrivyUser(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const source = url.searchParams.get("source");
  const hash = url.searchParams.get("hash");
  if (!(source === "ethereum" || source === "arc") || !hash || !isHash(hash)) {
    return NextResponse.json({ error: "Invalid source or burn hash" }, { status: 400 });
  }
  const domain = DEPOSIT_CHAINS[source as DepositChain].domain;
  try {
    const endpoint = `https://iris-api-sandbox.circle.com/v2/messages/${domain}?transactionHash=${encodeURIComponent(hash)}`;
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
    if (!response.ok) return NextResponse.json({ error: "Circle attestation service is unavailable" }, { status: 502 });
    const body = await response.json() as { messages?: Array<{ status?: string; message?: string; attestation?: string; destinationMintTxHash?: string }> };
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const message = messages.find((item) => item.status === "complete" && item.message?.startsWith("0x") && item.attestation?.startsWith("0x"));
    return NextResponse.json(message ? {
      status: "complete", message: message.message, attestation: message.attestation,
      destinationMintTxHash: message.destinationMintTxHash || null,
    } : { status: "pending" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Unable to contact Circle attestation service" }, { status: 502 });
  }
}
