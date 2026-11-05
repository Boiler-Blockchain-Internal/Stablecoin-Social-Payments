// SERVER ONLY. Verifies Base Sepolia evidence before writing a payment result.
import { decodeEventLog, decodeFunctionData, isAddress, parseAbiItem, type Address, type Hash } from "viem";
import {
  entryPoint06Abi,
  entryPoint06Address,
  entryPoint07Abi,
  entryPoint07Address,
} from "viem/account-abstraction";
import { chain, CHAIN_ID, erc20Abi, publicClient, toUsdcUnits, USDC_ADDRESS } from "@/lib/chain";
import { getSmartWalletAddress, UnauthorizedError } from "@/lib/privy";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { isValidUsername, normalizeUsername } from "@/lib/username";
import { isUuid, NOTE_MAX, parseAmount } from "@/features/requests/validation";

export class SendApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function sendErrorResponse(error: unknown, fallback: string): Response {
  if (error instanceof UnauthorizedError) return Response.json({ error: error.message }, { status: 401 });
  if (error instanceof SendApiError) return Response.json({ error: error.message }, { status: error.status });
  console.error(fallback, error);
  return Response.json({ error: fallback }, { status: 500 });
}

export async function readSendBody(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try { body = await request.json(); } catch {
    throw new SendApiError("Send a valid JSON object.", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new SendApiError("Send a valid JSON object.", 400);
  return body as Record<string, unknown>;
}

export type PaymentIntent = {
  id: string;
  from_user: string;
  to_user: string;
  amount: string;
  note: string | null;
  tx_hash: string | null;
  status: "pending" | "confirmed" | "failed";
  request_id: string | null;
  client_reference: string;
  created_at: string;
};

function samePayment(intent: PaymentIntent, fromUser: string, toUser: string, amount: string, note: string | null, requestId: string | null): boolean {
  try {
    return intent.from_user === fromUser && intent.to_user === toUser &&
      toUsdcUnits(String(intent.amount)) === toUsdcUnits(amount) && intent.note === note && intent.request_id === requestId;
  } catch {
    return false;
  }
}

export async function preparePayment(privyId: string, input: Record<string, unknown>) {
  const username = typeof input.toUsername === "string" ? normalizeUsername(input.toUsername) : "";
  const amount = parseAmount(input.amount);
  const reference = input.clientReference;
  const requestId = input.requestId === undefined || input.requestId === null ? null : String(input.requestId);
  if (input.note !== undefined && input.note !== null && typeof input.note !== "string") {
    throw new SendApiError("Notes must be plain text.", 400);
  }
  const note = typeof input.note === "string" ? input.note.trim() || null : null;
  if (!isValidUsername(username)) throw new SendApiError("Choose a valid recipient username.", 400);
  if (!amount) throw new SendApiError("Enter an amount greater than 0 and up to 10,000 USDC, with at most 6 decimal places.", 400);
  if (note && note.length > NOTE_MAX) throw new SendApiError(`Notes must be ${NOTE_MAX} characters or fewer.`, 400);
  if (!isUuid(String(reference ?? ""))) throw new SendApiError("A valid payment reference is required.", 400);
  if (requestId !== null && !isUuid(requestId)) throw new SendApiError("That request link isn’t valid.", 400);

  const db = getSupabaseAdmin();
  const [senderResult, recipientResult, privyWallet] = await Promise.all([
    db.from("users").select("id, username, wallet_address").eq("privy_id", privyId).maybeSingle(),
    db.from("users").select("id, privy_id, username, wallet_address").eq("username", username).maybeSingle(),
    getSmartWalletAddress(privyId),
  ]);
  if (senderResult.error || recipientResult.error) throw senderResult.error ?? recipientResult.error;
  const sender = senderResult.data;
  const recipient = recipientResult.data;
  if (!sender?.username) throw new SendApiError("Finish setting up your profile before sending.", 409);
  if (!sender.wallet_address || !isAddress(sender.wallet_address) || !privyWallet ||
    sender.wallet_address.toLowerCase() !== privyWallet.toLowerCase()) {
    throw new SendApiError("Your smart wallet is still initializing. Refresh your profile and try again.", 409);
  }
  if (!recipient) throw new SendApiError("No user was found with that username.", 404);
  if (recipient.id === sender.id) throw new SendApiError("Choose someone else to send USDC to.", 400);
  const recipientWallet = recipient.privy_id ? await getSmartWalletAddress(recipient.privy_id) : null;
  if (!recipient.wallet_address || !isAddress(recipient.wallet_address) || !recipientWallet ||
    recipient.wallet_address.toLowerCase() !== recipientWallet.toLowerCase()) {
    throw new SendApiError("That user’s smart wallet is not ready yet.", 409);
  }

  if (requestId) {
    const requestResult = await db.from("requests").select("id, requester_id, payer_id, amount, status").eq("id", requestId).maybeSingle();
    if (requestResult.error) throw requestResult.error;
    let requestAmountMatches = false;
    try { requestAmountMatches = toUsdcUnits(String(requestResult.data?.amount)) === toUsdcUnits(amount); } catch { /* Invalid stored amount. */ }
    if (!requestResult.data || requestResult.data.status !== "pending" || requestResult.data.payer_id !== sender.id ||
      requestResult.data.requester_id !== recipient.id || !requestAmountMatches) {
      throw new SendApiError("This payment no longer matches the pending request.", 409);
    }
  }

  const clientReference = String(reference);
  const existing = await db.from("transactions").select("id, from_user, to_user, amount, note, tx_hash, status, request_id, client_reference, created_at")
    .eq("client_reference", clientReference).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    const intent = existing.data as PaymentIntent;
    if (!samePayment(intent, sender.id, recipient.id, amount, note, requestId)) throw new SendApiError("That payment reference is already in use.", 409);
    return { payment: intent, created: false, senderAddress: sender.wallet_address, recipientAddress: recipientWallet };
  }

  if (requestId) {
    // One live payment per request: a retry after a lost link must reuse it, never send again.
    const prior = await db.from("transactions").select("id, from_user, to_user, status, request_id")
      .eq("request_id", requestId).in("status", ["pending", "confirmed"]).maybeSingle();
    if (prior.error) throw prior.error;
    if (prior.data?.status === "confirmed") {
      await settleLinkedRequest(prior.data);
      throw new SendApiError("This request is already paid.", 409);
    }
    if (prior.data) throw new SendApiError("A payment for this request is already in progress. Reconcile it before trying again.", 409);
  }

  const openSend = await db.from("transactions")
    .select("id, from_user, to_user, amount, note, tx_hash, status, request_id, client_reference, created_at")
    .eq("from_user", sender.id).eq("status", "pending").not("client_reference", "is", null)
    .maybeSingle();
  if (openSend.error) throw openSend.error;
  if (openSend.data) {
    throw new SendApiError("A previous payment is still pending. Reconcile it before starting another transfer.", 409);
  }

  const inserted = await db.from("transactions").insert({
    from_user: sender.id,
    to_user: recipient.id,
    amount,
    note,
    tx_hash: null,
    status: "pending",
    request_id: requestId,
    client_reference: clientReference,
  }).select("id, from_user, to_user, amount, note, tx_hash, status, request_id, client_reference, created_at").single();
  if (inserted.error?.code === "23505") {
    const raced = await db.from("transactions").select("id, from_user, to_user, amount, note, tx_hash, status, request_id, client_reference, created_at")
      .eq("client_reference", clientReference).maybeSingle();
    if (raced.error) throw raced.error;
    if (raced.data && samePayment(raced.data as PaymentIntent, sender.id, recipient.id, amount, note, requestId)) {
      return { payment: raced.data as PaymentIntent, created: false, senderAddress: sender.wallet_address, recipientAddress: recipientWallet };
    }
    const active = await db.from("transactions")
      .select("id").eq("from_user", sender.id).eq("status", "pending").not("client_reference", "is", null)
      .maybeSingle();
    if (active.error) throw active.error;
    if (active.data) throw new SendApiError("A previous payment is still pending. Reconcile it before starting another transfer.", 409);
  }
  if (inserted.error) throw inserted.error;
  return { payment: inserted.data as PaymentIntent, created: true, senderAddress: sender.wallet_address, recipientAddress: recipientWallet };
}

export async function getOpenPaymentForCaller(privyId: string): Promise<{ payment: PaymentIntent; toUsername: string } | null> {
  const db = getSupabaseAdmin();
  const owner = await db.from("users").select("id").eq("privy_id", privyId).maybeSingle();
  if (owner.error) throw owner.error;
  if (!owner.data?.id) return null;
  const result = await db.from("transactions")
    .select("id, from_user, to_user, amount, note, tx_hash, status, request_id, client_reference, created_at")
    .eq("from_user", owner.data.id).eq("status", "pending").not("client_reference", "is", null).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) return null;
  const payment = result.data as PaymentIntent;
  const recipient = await db.from("users").select("username").eq("id", payment.to_user).maybeSingle();
  if (recipient.error) throw recipient.error;
  if (!recipient.data?.username) throw new SendApiError("The recipient for this pending payment could not be found.", 409);
  return { payment, toUsername: recipient.data.username };
}

export async function getPaymentForCaller(privyId: string, paymentId: string): Promise<PaymentIntent> {
  if (!isUuid(paymentId)) throw new SendApiError("That payment link isn’t valid.", 400);
  const db = getSupabaseAdmin();
  const [owner, result] = await Promise.all([
    db.from("users").select("id").eq("privy_id", privyId).maybeSingle(),
    db.from("transactions").select("id, from_user, to_user, amount, note, tx_hash, status, request_id, client_reference, created_at")
      .eq("id", paymentId).maybeSingle(),
  ]);
  if (owner.error || result.error) throw owner.error ?? result.error;
  if (!result.data) throw new SendApiError("Payment not found.", 404);
  const payment = result.data as PaymentIntent;
  if (payment.from_user !== owner.data?.id) throw new SendApiError("You can’t update this payment.", 403);
  return payment;
}

function receiptHasExpectedTransfer(receipt: Awaited<ReturnType<typeof publicClient.getTransactionReceipt>>, payment: PaymentIntent, from: Address, to: Address): boolean {
  const expectedAmount = toUsdcUnits(String(payment.amount));
  return receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== USDC_ADDRESS.toLowerCase()) return false;
    try {
      const decoded = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", data: log.data, topics: log.topics });
      return decoded.args.from.toLowerCase() === from.toLowerCase() &&
        decoded.args.to.toLowerCase() === to.toLowerCase() && decoded.args.value === expectedAmount;
    } catch {
      return false;
    }
  });
}

function receiptHasFailedUserOperation(receipt: Awaited<ReturnType<typeof publicClient.getTransactionReceipt>>, sender: Address): boolean {
  return receipt.logs.some((log) => {
    if (log.address.toLowerCase() === entryPoint06Address.toLowerCase()) {
      try {
        const decoded = decodeEventLog({ abi: entryPoint06Abi, eventName: "UserOperationEvent", data: log.data, topics: log.topics });
        return decoded.args.sender.toLowerCase() === sender.toLowerCase() && !decoded.args.success;
      } catch { return false; }
    }
    if (log.address.toLowerCase() === entryPoint07Address.toLowerCase()) {
      try {
        const decoded = decodeEventLog({ abi: entryPoint07Abi, eventName: "UserOperationEvent", data: log.data, topics: log.topics });
        return decoded.args.sender.toLowerCase() === sender.toLowerCase() && !decoded.args.success;
      } catch { return false; }
    }
    return false;
  });
}

const CLOCK_SKEW_SECONDS = 120;

/**
 * A confirmed payment made for a request settles that request in the same step, so the request
 * can never stay payable after its money moved (and the browser never has to finish the job).
 */
export async function settleLinkedRequest(payment: Pick<PaymentIntent, "from_user" | "to_user" | "request_id">) {
  if (!payment.request_id) return;
  const { error } = await getSupabaseAdmin().from("requests").update({ status: "paid" })
    .eq("id", payment.request_id).eq("status", "pending")
    .eq("payer_id", payment.from_user).eq("requester_id", payment.to_user);
  if (error) throw error;
}

async function ensureAfterIntent(receipt: Awaited<ReturnType<typeof publicClient.getTransactionReceipt>>, payment: PaymentIntent) {
  const block = await publicClient.getBlock({ blockHash: receipt.blockHash });
  // Allow for clock skew between the database and the sequencer.
  const intentTimeSeconds = Math.floor(new Date(payment.created_at).getTime() / 1000) - CLOCK_SKEW_SECONDS;
  if (!Number.isFinite(intentTimeSeconds) || Number(block.timestamp) < intentTimeSeconds) {
    throw new SendApiError("This transaction predates the payment request and cannot be attached to it.", 409);
  }
}

async function isDirectTransfer(hash: Hash, payment: PaymentIntent, from: Address, to: Address): Promise<boolean> {
  try {
    const transaction = await publicClient.getTransaction({ hash });
    if (transaction.from.toLowerCase() !== from.toLowerCase() || transaction.to?.toLowerCase() !== USDC_ADDRESS.toLowerCase()) return false;
    const decoded = decodeFunctionData({ abi: erc20Abi, data: transaction.input });
    return decoded.functionName === "transfer" &&
      decoded.args[0].toLowerCase() === to.toLowerCase() && decoded.args[1] === toUsdcUnits(String(payment.amount));
  } catch {
    return false;
  }
}

export async function recordPaymentHash(privyId: string, paymentId: string, rawHash: unknown) {
  const payment = await getPaymentForCaller(privyId, paymentId);
  if (typeof rawHash !== "string" || !/^0x[0-9a-f]{64}$/i.test(rawHash)) throw new SendApiError("A valid transaction hash is required.", 400);
  const hash = rawHash.toLowerCase() as Hash;
  if (payment.tx_hash && payment.tx_hash !== hash) throw new SendApiError("This payment already has a different transaction hash.", 409);
  if (payment.status !== "pending") {
    if (payment.status === "confirmed") await settleLinkedRequest(payment);
    return { payment };
  }

  const db = getSupabaseAdmin();
  const [sender, recipient] = await Promise.all([
    db.from("users").select("wallet_address").eq("id", payment.from_user).maybeSingle(),
    db.from("users").select("wallet_address").eq("id", payment.to_user).maybeSingle(),
  ]);
  if (sender.error || recipient.error) throw sender.error ?? recipient.error;
  const senderAddress = sender.data?.wallet_address;
  const recipientAddress = recipient.data?.wallet_address;
  if (!senderAddress || !recipientAddress || !isAddress(senderAddress) || !isAddress(recipientAddress)) {
    throw new SendApiError("A smart wallet address is missing for this payment.", 409);
  }
  const chainId = await publicClient.getChainId();
  if (chainId !== CHAIN_ID || chain.id !== CHAIN_ID) throw new SendApiError("Payment verification is not connected to Base Sepolia.", 503);

  let status: PaymentIntent["status"] = "pending";
  let receipt;
  try {
    receipt = await publicClient.getTransactionReceipt({ hash });
  } catch {
    // A not-yet-mined transaction is only attached when its direct call can be verified below.
  }

  if (receipt?.status === "success") {
    if (receiptHasExpectedTransfer(receipt, payment, senderAddress as Address, recipientAddress as Address)) {
      await ensureAfterIntent(receipt, payment);
      status = "confirmed";
    } else if (receiptHasFailedUserOperation(receipt, senderAddress as Address)) {
      // Privy smart-wallet transfers are ERC-4337 UserOperations. The outer bundler
      // transaction can succeed even when the account call failed; verify the
      // EntryPoint event before recording that outcome as failed.
      await ensureAfterIntent(receipt, payment);
      status = "failed";
    } else {
      throw new SendApiError("This transaction does not contain the expected USDC transfer.", 409);
    }
  } else if (receipt?.status === "reverted") {
    if (!await isDirectTransfer(hash, payment, senderAddress as Address, recipientAddress as Address)) {
      return { payment, retry: true };
    }
    status = "failed";
  } else if (!await isDirectTransfer(hash, payment, senderAddress as Address, recipientAddress as Address)) {
    // Keep the intent pending without persisting an arbitrary, unverifiable hash.
    return { payment, retry: true };
  }

  const update = await db.from("transactions").update({ tx_hash: hash, status })
    .eq("id", payment.id).eq("status", "pending").or(`tx_hash.is.null,tx_hash.eq.${hash}`)
    .select("id, from_user, to_user, amount, note, tx_hash, status, request_id, client_reference, created_at").maybeSingle();
  if (update.error?.code === "23505") throw new SendApiError("This transaction is already attached to another payment.", 409);
  if (update.error) throw update.error;
  if (update.data) {
    if (status === "confirmed") await settleLinkedRequest(update.data as PaymentIntent);
    return { payment: update.data as PaymentIntent };
  }

  const current = await getPaymentForCaller(privyId, payment.id);
  if (current.tx_hash === hash && current.status === status) {
    if (status === "confirmed") await settleLinkedRequest(current);
    return { payment: current };
  }
  throw new SendApiError("The payment changed while it was being recorded. Check its status before retrying.", 409);
}

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
// The public Base Sepolia RPC caps eth_getLogs at 200 blocks; blocks are ~2s apart.
const LOG_CHUNK_BLOCKS = BigInt(200);
const BLOCK_SECONDS = 2;
// A wallet prompt that hasn't landed within an hour of the intent never will (bundlers drop it).
const LANDING_WINDOW_BLOCKS = BigInt(1_800);
// A manual cancel must wait this long, so a transfer still in the bundler's mempool can land first.
const MANUAL_CANCEL_DELAY_MS = 5 * 60_000;

/** Unrecorded USDC transfers matching the intent, from just before it to an hour after, oldest first. */
async function findCandidateTransfers(payment: PaymentIntent): Promise<Hash[]> {
  const db = getSupabaseAdmin();
  const [sender, recipient] = await Promise.all([
    db.from("users").select("wallet_address").eq("id", payment.from_user).maybeSingle(),
    db.from("users").select("wallet_address").eq("id", payment.to_user).maybeSingle(),
  ]);
  if (sender.error || recipient.error) throw sender.error ?? recipient.error;
  const from = sender.data?.wallet_address;
  const to = recipient.data?.wallet_address;
  if (!from || !to || !isAddress(from) || !isAddress(to)) {
    throw new SendApiError("A wallet address is missing, so this payment can't be checked on-chain. Paste its transaction hash instead.", 409);
  }
  const latest = await publicClient.getBlockNumber();
  const ageSeconds = Math.max(0, (Date.now() - new Date(payment.created_at).getTime()) / 1000);
  const ageBlocks = BigInt(Math.ceil((ageSeconds + CLOCK_SKEW_SECONDS) / BLOCK_SECONDS));
  const start = latest > ageBlocks ? latest - ageBlocks : BigInt(0);
  const stop = start + LANDING_WINDOW_BLOCKS < latest ? start + LANDING_WINDOW_BLOCKS : latest;
  const expected = toUsdcUnits(String(payment.amount));
  const hashes: Hash[] = [];
  for (let fromBlock = start; fromBlock <= stop; fromBlock += LOG_CHUNK_BLOCKS) {
    const toBlock = fromBlock + LOG_CHUNK_BLOCKS - BigInt(1) < stop ? fromBlock + LOG_CHUNK_BLOCKS - BigInt(1) : stop;
    const logs = await publicClient.getLogs({ address: USDC_ADDRESS, event: transferEvent, args: { from: from as Address, to: to as Address }, fromBlock, toBlock });
    for (const log of logs) {
      const hash = log.transactionHash?.toLowerCase() as Hash | undefined;
      if (log.args.value === expected && hash && !hashes.includes(hash)) hashes.push(hash);
    }
  }
  if (hashes.length === 0) return [];
  // Transfers already attached to another payment (e.g. an earlier send of the same amount) aren't this one.
  const recorded = await db.from("transactions").select("tx_hash").in("tx_hash", hashes);
  if (recorded.error) throw recorded.error;
  const taken = new Set((recorded.data ?? []).map((row) => String(row.tx_hash).toLowerCase()));
  return hashes.filter((hash) => !taken.has(hash));
}

export async function cancelUnsubmittedPayment(privyId: string, paymentId: string, immediate = false) {
  const payment = await getPaymentForCaller(privyId, paymentId);
  if (payment.status !== "pending" || payment.tx_hash) throw new SendApiError("This payment can no longer be cancelled as unsubmitted.", 409);
  if (!immediate && Date.now() - new Date(payment.created_at).getTime() < MANUAL_CANCEL_DELAY_MS) {
    throw new SendApiError("This payment may still be landing. Wait a few minutes, then try cancelling again.", 409);
  }
  // If the wallet did send, record that transfer instead of cancelling and allowing a second one.
  for (const hash of await findCandidateTransfers(payment)) {
    let recorded;
    try {
      recorded = await recordPaymentHash(privyId, paymentId, hash);
    } catch (error) {
      if (error instanceof SendApiError && error.status === 409) continue; // Predates the intent, or not ours.
      throw error;
    }
    if (recorded.payment.status !== "pending") return recorded;
    throw new SendApiError("A matching transfer was found on-chain and is still confirming. Check again shortly.", 409);
  }
  const { data, error } = await getSupabaseAdmin().from("transactions").update({ status: "failed" })
    .eq("id", payment.id).eq("status", "pending").is("tx_hash", null)
    .select("id, from_user, to_user, amount, note, tx_hash, status, request_id, client_reference, created_at").maybeSingle();
  if (error) throw error;
  if (data) return { payment: data as PaymentIntent };
  const current = await getPaymentForCaller(privyId, payment.id);
  if (current.status === "failed" && !current.tx_hash) return { payment: current };
  throw new SendApiError("This payment could not be cancelled safely.", 409);
}
