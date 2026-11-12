// SERVER ONLY. Tracks CCTP deposits: verifies each burn on its source chain, asks Circle for the
// attestation, and checks Base Sepolia to see whether the mint already happened.
import { formatUnits, isAddress, isHash, type Address, type Hash, type Hex } from "viem";
import { getSmartWalletAddress, UnauthorizedError } from "@/lib/privy";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { CCTP_MESSAGE_TRANSMITTER, DEPOSIT_CHAINS, baseClient, findDepositBurn, isDepositChain, mintedTo, receiveAbi, sourceClient, type DepositChain } from "./cctp";

export class DepositError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function depositErrorResponse(error: unknown, fallback: string): Response {
  if (error instanceof UnauthorizedError) return Response.json({ error: error.message }, { status: 401 });
  if (error instanceof DepositError) return Response.json({ error: error.message }, { status: error.status });
  console.error(fallback, error);
  return Response.json({ error: fallback }, { status: 500 });
}

export type DepositRow = {
  id: string;
  user_id: string;
  source: DepositChain;
  burn_tx_hash: string;
  amount: string;
  status: "pending" | "completed";
  mint_tx_hash: string | null;
  created_at: string;
};

/**
 * Where a deposit stands. `ready` carries what the browser needs to mint with the user's smart wallet;
 * anyone may submit it, since the burn fixed the recipient.
 */
export type DepositProgress =
  | { status: "burning" }
  | { status: "attesting"; deposit: DepositRow }
  | { status: "ready"; deposit: DepositRow; message: Hex; attestation: Hex }
  | { status: "completed"; deposit: DepositRow };

const COLUMNS = "id, user_id, source, burn_tx_hash, amount, status, mint_tx_hash, created_at";

/** The outside world this module talks to; tests pass fakes instead of mocking viem. */
export type DepositNetwork = {
  source: (chain: DepositChain) => Pick<ReturnType<typeof sourceClient>, "getTransactionReceipt">;
  base: Pick<typeof baseClient, "readContract" | "getTransactionReceipt">;
  fetch: typeof fetch;
};
const liveNetwork: DepositNetwork = { source: sourceClient, base: baseClient, fetch: (...args) => fetch(...args) };
const IRIS = "https://iris-api-sandbox.circle.com/v2/messages";

async function getCaller(privyId: string): Promise<{ id: string; wallet: Address }> {
  const db = getSupabaseAdmin();
  const [row, wallet] = await Promise.all([
    db.from("users").select("id").eq("privy_id", privyId).maybeSingle(),
    getSmartWalletAddress(privyId),
  ]);
  if (row.error) throw row.error;
  if (!row.data) throw new DepositError("Finish setting up your profile first.", 409);
  if (!wallet || !isAddress(wallet)) throw new DepositError("Your smart wallet is still initializing. Try again shortly.", 409);
  return { id: row.data.id, wallet };
}

export async function listDeposits(privyId: string): Promise<DepositRow[]> {
  const caller = await getCaller(privyId);
  const { data, error } = await getSupabaseAdmin().from("deposits").select(COLUMNS)
    .eq("user_id", caller.id).order("created_at", { ascending: false }).limit(20);
  if (error) throw error;
  return (data ?? []) as DepositRow[];
}

type IrisMessage = { status?: string; message?: string; attestation?: string; eventNonce?: string; destinationMintTxHash?: string };

async function fetchAttestation(net: DepositNetwork, source: DepositChain, burnHash: string): Promise<IrisMessage | null> {
  let response: Response;
  try {
    response = await net.fetch(`${IRIS}/${DEPOSIT_CHAINS[source].domain}?transactionHash=${burnHash}`, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  } catch {
    throw new DepositError("Couldn't reach Circle's attestation service. Try again shortly.", 502);
  }
  // Circle answers 404 until it has indexed the burn: that is "not ready yet", not an outage.
  if (response.status === 404) return null;
  if (!response.ok) throw new DepositError("Circle's attestation service is unavailable. Try again shortly.", 502);
  const body = await response.json().catch(() => ({})) as { messages?: IrisMessage[] };
  return (body.messages ?? []).find((m) => m.status === "complete" && m.message?.startsWith("0x") &&
    m.attestation?.startsWith("0x") && m.eventNonce?.startsWith("0x")) ?? null;
}

/**
 * Record (once verified) and advance a deposit. Call it after the burn, while waiting, and after
 * submitting the mint with `mintHash`; it is idempotent.
 */
export async function progressDeposit(privyId: string, input: Record<string, unknown>, net: DepositNetwork = liveNetwork): Promise<DepositProgress> {
  const source = input.source;
  const burnHash = typeof input.burnHash === "string" ? input.burnHash.toLowerCase() : "";
  if (!isDepositChain(source)) throw new DepositError("Choose Ethereum Sepolia or Arc Testnet.", 400);
  if (!isHash(burnHash)) throw new DepositError("A valid burn transaction hash is required.", 400);
  const mintHash = typeof input.mintHash === "string" && isHash(input.mintHash) ? input.mintHash.toLowerCase() as Hash : null;
  const caller = await getCaller(privyId);
  const db = getSupabaseAdmin();

  let found = await db.from("deposits").select(COLUMNS).eq("burn_tx_hash", burnHash).maybeSingle();
  if (found.error) throw found.error;
  let deposit = found.data as DepositRow | null;
  if (deposit && deposit.user_id !== caller.id) throw new DepositError("This deposit belongs to another account.", 409);
  if (deposit && deposit.source !== source) throw new DepositError("This burn was recorded on a different network.", 409);
  if (deposit?.status === "completed") return { status: "completed", deposit };

  if (!deposit) {
    let receipt;
    try {
      receipt = await net.source(source).getTransactionReceipt({ hash: burnHash });
    } catch {
      return { status: "burning" }; // Not mined yet (or the RPC hasn't seen it).
    }
    if (receipt.status !== "success") throw new DepositError("The burn transaction failed on the source network. No USDC left your wallet.", 409);
    const burn = findDepositBurn(receipt.logs, source, caller.wallet);
    if (!burn) throw new DepositError("That transaction isn't a CCTP deposit to your StablePay wallet.", 409);
    // Record what is guaranteed to arrive: the burn minus its maximum fee (Standard transfers have none).
    const inserted = await db.from("deposits").insert({
      user_id: caller.id, source, burn_tx_hash: burnHash, amount: formatUnits(burn.amount - burn.maxFee > BigInt(0) ? burn.amount - burn.maxFee : burn.amount, 6), status: "pending",
    }).select(COLUMNS).single();
    if (inserted.error?.code === "23505") {
      found = await db.from("deposits").select(COLUMNS).eq("burn_tx_hash", burnHash).maybeSingle();
      if (found.error) throw found.error;
      deposit = found.data as DepositRow | null;
      if (!deposit || deposit.user_id !== caller.id) throw new DepositError("This deposit belongs to another account.", 409);
    } else if (inserted.error) {
      throw inserted.error;
    } else {
      deposit = inserted.data as DepositRow;
    }
  }

  const attested = await fetchAttestation(net, source, burnHash);
  if (!attested) return { status: "attesting", deposit };
  const used = await net.base.readContract({ address: CCTP_MESSAGE_TRANSMITTER, abi: receiveAbi, functionName: "usedNonces", args: [attested.eventNonce as Hex] });
  if (used === BigInt(0)) return { status: "ready", deposit, message: attested.message as Hex, attestation: attested.attestation as Hex };

  // Minted. Keep a mint hash we can vouch for: Circle's, or the browser's once its receipt shows the mint.
  let proven: string | null = attested.destinationMintTxHash && isHash(attested.destinationMintTxHash) ? attested.destinationMintTxHash.toLowerCase() : null;
  if (!proven && mintHash) {
    try {
      const receipt = await net.base.getTransactionReceipt({ hash: mintHash });
      if (receipt.status === "success" && mintedTo(receipt.logs, caller.wallet) > BigInt(0)) proven = mintHash;
    } catch { /* Leave it unset; the deposit is complete either way. */ }
  }
  const updated = await db.from("deposits").update({ status: "completed", mint_tx_hash: proven })
    .eq("id", deposit.id).eq("status", "pending").select(COLUMNS).maybeSingle();
  if (updated.error) throw updated.error;
  return { status: "completed", deposit: (updated.data as DepositRow | null) ?? { ...deposit, status: "completed", mint_tx_hash: proven } };
}
