"use client";

import { useCallback, useSyncExternalStore } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { encodeFunctionData, isAddress, type Address, type Hash } from "viem";
import { chain, CHAIN_ID, erc20Abi, getUsdcBalance, toUsdcUnits, USDC_ADDRESS, publicClient } from "@/lib/chain";
import { isValidUsername, normalizeUsername } from "@/lib/username";
import { NOTE_MAX, parseAmount } from "@/features/requests/validation";
import { linkedSmartWalletAddress } from "@/features/auth/linkedSmartWallet";

const RECOVERY_KEY = "stablepay:payment-recovery";
const RECOVERY_EVENT = "stablepay:payment-recovery";

export type PaymentRecovery = {
  /** Privy user id; recovery is per account so a second login on this browser isn't blocked. */
  owner: string;
  paymentId: string;
  txHash?: string;
  toUsername: string;
  amount: string;
  note?: string;
  requestId?: string;
};

export type SendProgress = "preparing" | "submitting" | "confirming" | "recording";

let recoverySnapshot: PaymentRecovery | null | undefined;

function recoverySnapshotForClient(): PaymentRecovery | null {
  if (recoverySnapshot === undefined) recoverySnapshot = readPaymentRecovery();
  return recoverySnapshot;
}

function subscribeToRecovery(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  const refresh = () => {
    recoverySnapshot = readPaymentRecovery();
    callback();
  };
  window.addEventListener("storage", refresh);
  window.addEventListener(RECOVERY_EVENT, refresh);
  return () => {
    window.removeEventListener("storage", refresh);
    window.removeEventListener(RECOVERY_EVENT, refresh);
  };
}

export function usePaymentRecovery(): PaymentRecovery | null {
  const { user } = usePrivy();
  const recovery = useSyncExternalStore(subscribeToRecovery, recoverySnapshotForClient, () => null);
  return recovery && recovery.owner === user?.id ? recovery : null;
}

export class PaymentSendError extends Error {
  constructor(
    message: string,
    readonly recovery: PaymentRecovery,
  ) {
    super(message);
    this.name = "PaymentSendError";
  }
}

export function readPaymentRecovery(): PaymentRecovery | null {
  if (typeof window === "undefined") return null;
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(RECOVERY_KEY) ?? "null");
    if (!value || typeof value !== "object") return null;
    const item = value as Partial<PaymentRecovery>;
    if (typeof item.owner !== "string" || typeof item.paymentId !== "string" || typeof item.toUsername !== "string" || typeof item.amount !== "string") return null;
    return {
      owner: item.owner,
      paymentId: item.paymentId,
      ...(typeof item.txHash === "string" ? { txHash: item.txHash } : {}),
      toUsername: item.toUsername,
      amount: item.amount,
      ...(typeof item.note === "string" ? { note: item.note } : {}),
      ...(typeof item.requestId === "string" ? { requestId: item.requestId } : {}),
    };
  } catch {
    return null;
  }
}

function savePaymentRecovery(recovery: PaymentRecovery) {
  window.localStorage.setItem(RECOVERY_KEY, JSON.stringify(recovery));
  recoverySnapshot = recovery;
  window.dispatchEvent(new Event(RECOVERY_EVENT));
}

export function clearPaymentRecovery(paymentId?: string) {
  if (typeof window === "undefined") return;
  const existing = readPaymentRecovery();
  if (!existing || (paymentId && existing.paymentId !== paymentId)) return;
  window.localStorage.removeItem(RECOVERY_KEY);
  recoverySnapshot = null;
  window.dispatchEvent(new Event(RECOVERY_EVENT));
}

type ApiError = { error?: string };
type PaymentResult = { payment: { id: string; status: "pending" | "confirmed" | "failed"; tx_hash: string | null; request_id?: string | null } };

async function apiJson<T>(url: string, token: string, body?: unknown): Promise<{ response: Response; data: T }> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({})) as T;
  return { response, data };
}

function apiMessage(data: unknown, fallback: string): string {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : fallback;
}

function isRejectedTransaction(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; name?: unknown; message?: unknown };
  const code = String(value.code ?? "");
  const message = String(value.message ?? "").toLowerCase();
  return code === "4001" || code === "ACTION_REJECTED" ||
    String(value.name ?? "").toLowerCase().includes("userrejected") ||
    message.includes("user rejected") || message.includes("user denied");
}

function isDefinitePreSubmissionFailure(error: unknown): boolean {
  if (isRejectedTransaction(error)) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return ["paymaster", "sponsor", "insufficient funds", "gas estimation", "simulation failed", "unsupported chain"]
    .some((term) => message.includes(term));
}

export function friendlySendError(error: unknown): string {
  if (error instanceof PaymentSendError) return error.message;
  if (!(error instanceof Error)) return "The payment could not be sent. Please try again.";
  const message = error.message;
  const lower = message.toLowerCase();
  if (isRejectedTransaction(error)) return "The transaction was rejected in Privy. No payment was submitted.";
  if (lower.includes("insufficient test usdc") || lower.includes("insufficient usdc")) return "You don’t have enough USDC for this payment.";
  if (lower.includes("paymaster") || lower.includes("sponsor") || lower.includes("sponsorship")) {
    return "Gas sponsorship was unavailable. Check the Privy smart wallet paymaster policy for Base Sepolia.";
  }
  if (lower.includes("insufficient funds") || lower.includes("gas")) {
    return "The wallet could not cover the network fee. Check the Base Sepolia sponsorship setup and try again.";
  }
  if (lower.includes("timeout") || lower.includes("timed out")) return "The network is taking longer than expected. Check the payment status before trying again.";
  return message;
}

export function useSendUSDC() {
  const { getAccessToken, user } = usePrivy();
  const owner = user?.id;
  const { client } = useSmartWallets();

  const findOpenPayment = useCallback(async (): Promise<PaymentRecovery | null> => {
    const token = await getAccessToken();
    if (!token) throw new Error("Session expired. Please log in again.");
    const { response, data } = await apiJson<{
      payment?: { id: string; status: "pending" | "confirmed" | "failed"; tx_hash: string | null; amount: string; note: string | null; request_id: string | null } | null;
      toUsername?: string;
    } & ApiError>("/api/transactions", token);
    if (!response.ok) throw new Error(apiMessage(data, "Unable to check for an earlier payment."));
    const payment = data.payment;
    if (!payment || payment.status !== "pending" || !data.toUsername || !owner) return null;
    const recovery: PaymentRecovery = {
      owner,
      paymentId: payment.id,
      ...(payment.tx_hash ? { txHash: payment.tx_hash } : {}),
      toUsername: data.toUsername,
      amount: String(payment.amount),
      ...(payment.note ? { note: payment.note } : {}),
      ...(payment.request_id ? { requestId: payment.request_id } : {}),
    };
    savePaymentRecovery(recovery);
    return recovery;
  }, [getAccessToken, owner]);

  const retryRecord = useCallback(async (recovery: PaymentRecovery, submittedHash?: string) => {
    const token = await getAccessToken();
    if (!token) throw new Error("Session expired. Please log in again.");
    const txHash = submittedHash?.trim() || recovery.txHash;
    if (!txHash) throw new Error("Enter the transaction hash from wallet activity before reconciling this payment.");
    const withHash = { ...recovery, txHash };
    // Preserve the candidate before the request so a refresh or API timeout can retry
    // the same hash. The server independently verifies it before attaching it.
    savePaymentRecovery(withHash);
    const { response, data } = await apiJson<PaymentResult & ApiError>(
      `/api/transactions/${recovery.paymentId}`,
      token,
      { txHash },
    );
    if (response.status === 403 || response.status === 404) {
      // Not this account's payment (or gone): drop the stale local record.
      clearPaymentRecovery(recovery.paymentId);
      throw new Error(apiMessage(data, "This payment can't be reconciled from this account."));
    }
    if (!response.ok && response.status !== 202) {
      if (!recovery.txHash && response.status < 500) savePaymentRecovery(recovery);
      throw new Error(apiMessage(data, "Unable to reconcile this payment."));
    }
    const payment = data.payment;
    if (!payment) throw new Error("The payment status could not be checked yet.");
    if (!recovery.txHash && response.status === 202 && payment.tx_hash !== txHash) {
      // An unrecognized candidate was deliberately not attached by the server. Let
      // the user replace it instead of pinning a bad hash into recovery state.
      savePaymentRecovery(recovery);
    }
    // Confirming also settles a linked request on the server, so nothing is left to retry.
    if (payment.status === "confirmed") clearPaymentRecovery(recovery.paymentId);
    if (payment.status === "failed") clearPaymentRecovery(recovery.paymentId);
    return payment;
  }, [getAccessToken]);

  /**
   * Close an intent whose wallet prompt never produced a hash. The server first looks on-chain for a
   * matching transfer and records it instead, so cancelling can't open the door to a second payment.
   */
  const cancelPayment = useCallback(async (recovery: PaymentRecovery) => {
    const token = await getAccessToken();
    if (!token) throw new Error("Session expired. Please log in again.");
    const { response, data } = await apiJson<PaymentResult & ApiError>(`/api/transactions/${recovery.paymentId}`, token, { action: "cancel" });
    if (!response.ok) throw new Error(apiMessage(data, "This payment could not be cancelled."));
    if (data.payment && data.payment.status !== "pending") clearPaymentRecovery(recovery.paymentId);
    return data.payment;
  }, [getAccessToken]);

  const sendUSDC = useCallback(async (
    toUsername: string,
    amount: string,
    note?: string,
    options?: { requestId?: string; onProgress?: (progress: SendProgress) => void },
  ): Promise<{ txHash: string; paymentId: string; status: "confirmed" }> => {
    const username = normalizeUsername(toUsername);
    if (!isValidUsername(username)) throw new Error("Choose a valid recipient by username.");
    const validAmount = parseAmount(amount);
    if (!validAmount) throw new Error("Enter an amount greater than 0 and up to 10,000 USDC, with at most 6 decimal places.");
    const cleanNote = note?.trim() ?? "";
    if (cleanNote.length > NOTE_MAX) throw new Error(`Notes must be ${NOTE_MAX} characters or fewer.`);
    if (!client?.account?.address) throw new Error("Your smart wallet is still initializing. Please wait a moment and try again.");
    // Never sign with an SDK client left over from a previous account on this browser.
    if (!linkedSmartWalletAddress(user, client.account.address)) throw new Error("Your smart wallet is still switching accounts. Refresh the page and try again.");
    if (client.chain.id !== CHAIN_ID) throw new Error("Your smart wallet is not connected to Base Sepolia.");
    if (!owner) throw new Error("Session expired. Please log in again.");
    const stored = readPaymentRecovery();
    // Another account's record: the server still has it and restores it when that account returns.
    if (stored && stored.owner !== owner) clearPaymentRecovery(stored.paymentId);
    const unfinished = stored?.owner === owner ? stored : null;
    if (unfinished) {
      throw new PaymentSendError("Resolve the earlier payment before starting another one. This prevents accidentally sending twice.", unfinished);
    }
    const openPayment = await findOpenPayment();
    if (openPayment) {
      throw new PaymentSendError("An earlier payment is still unresolved. Reconcile it before starting another transfer.", openPayment);
    }

    const senderAddress = client.account.address as Address;
    const units = toUsdcUnits(validAmount);
    options?.onProgress?.("preparing");

    let currentBalance: bigint;
    try {
      currentBalance = await getUsdcBalance(senderAddress);
    } catch {
      throw new Error("Could not load your USDC balance. Check your connection and try again.");
    }
    if (currentBalance < units) throw new Error("Insufficient USDC balance for this payment.");

    const token = await getAccessToken();
    if (!token) throw new Error("Session expired. Please log in again.");
    const clientReference = crypto.randomUUID();
    const prepared = await apiJson<{
      payment?: { id: string; status: "pending" | "confirmed" | "failed"; tx_hash: string | null };
      recipientAddress?: string;
      senderAddress?: string;
      created?: boolean;
    } & ApiError>("/api/transactions", token, {
      action: "prepare",
      toUsername: username,
      amount: validAmount,
      note: cleanNote || null,
      clientReference,
      ...(options?.requestId ? { requestId: options.requestId } : {}),
    });
    if (!prepared.response.ok) throw new Error(apiMessage(prepared.data, "Unable to prepare this payment."));
    const intent = prepared.data.payment;
    if (!intent || !prepared.data.created) throw new Error("An existing payment needs reconciliation before a new transfer can start.");
    if (!prepared.data.recipientAddress || !isAddress(prepared.data.recipientAddress)) throw new Error("The recipient wallet is not ready yet.");
    if (prepared.data.senderAddress?.toLowerCase() !== senderAddress.toLowerCase()) {
      throw new Error("Your smart wallet is still syncing. Refresh your profile and try again.");
    }

    let recovery: PaymentRecovery = {
      owner,
      paymentId: intent.id,
      toUsername: username,
      amount: validAmount,
      ...(cleanNote ? { note: cleanNote } : {}),
      ...(options?.requestId ? { requestId: options.requestId } : {}),
    };
    try {
      savePaymentRecovery(recovery);
    } catch {
      // This happens before the wallet is called, so close the unused reservation.
      let cancelled = false;
      try {
        const result = await apiJson<PaymentResult & ApiError>(`/api/transactions/${intent.id}`, token, { action: "cancel", immediate: true });
        cancelled = result.response.ok;
      } catch { /* A failed cancellation must leave the sender locked rather than risk a duplicate. */ }
      if (cancelled) throw new Error("Payment recovery storage is unavailable. The wallet was not asked to send; enable browser storage and try again.");
      throw new PaymentSendError(
        "Payment recovery storage is unavailable. The wallet was not asked to send, but the pending intent could not be closed safely. Reconcile it before trying again.",
        recovery,
      );
    }

    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [prepared.data.recipientAddress as Address, units],
    });

    let txHash: Hash;
    options?.onProgress?.("submitting");
    try {
      txHash = await client.sendTransaction({
        to: USDC_ADDRESS,
        data,
        value: BigInt(0),
        chain,
      });
    } catch (error) {
      if (isDefinitePreSubmissionFailure(error)) {
        let cancelled = false;
        try {
          const result = await apiJson<PaymentResult & ApiError>(`/api/transactions/${intent.id}`, token, { action: "cancel", immediate: true });
          cancelled = result.response.ok;
        } catch {
          // Preserve the intent locally if its failed state could not be saved.
        }
        if (cancelled) {
          clearPaymentRecovery(intent.id);
          throw new Error(friendlySendError(error));
        }
        throw new PaymentSendError(
          `${friendlySendError(error)} The wallet did not return a hash, and the payment intent could not be closed safely. Check wallet activity before trying again.`,
          recovery,
        );
      }
      throw new PaymentSendError(
        "The wallet did not return a transaction hash. Check wallet activity before trying again; this payment is being held to prevent a duplicate.",
        recovery,
      );
    }

    recovery = { ...recovery, txHash };
    savePaymentRecovery(recovery);
    options?.onProgress?.("confirming");
    let receipt;
    try {
      receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 });
    } catch {
      throw new PaymentSendError(
        "The transfer was submitted, but confirmation is still pending. Check its status before sending again.",
        recovery,
      );
    }

    options?.onProgress?.("recording");
    let payment: PaymentResult["payment"];
    try {
      const recorded = await apiJson<PaymentResult & ApiError>(`/api/transactions/${intent.id}`, token, { txHash });
      if (!recorded.response.ok && recorded.response.status !== 202) {
        throw new Error(apiMessage(recorded.data, "Unable to record this payment."));
      }
      if (!recorded.data.payment) throw new Error("Payment status is not available yet.");
      payment = recorded.data.payment;
    } catch (cause) {
      const detail = cause instanceof Error ? ` ${cause.message}` : "";
      throw new PaymentSendError(
        `The wallet returned a transaction, but the server could not verify its payment record yet. Retry reconciliation with this same transaction; it will not send again.${detail}`,
        recovery,
      );
    }

    if (payment.status === "failed") {
      clearPaymentRecovery(intent.id);
      throw new Error("The transfer failed on Base Sepolia. No USDC was transferred.");
    }
    if (receipt.status === "reverted") {
      throw new PaymentSendError(
        "The transaction reverted, but the server could not yet verify that it belongs to this payment. Recheck the same hash before trying again.",
        recovery,
      );
    }
    if (payment.status !== "confirmed") {
      throw new PaymentSendError(
        "The transfer is still waiting for a verified confirmation. Recheck its status before trying again.",
        recovery,
      );
    }
    clearPaymentRecovery(intent.id);
    return { txHash, paymentId: intent.id, status: "confirmed" };
  }, [client, findOpenPayment, getAccessToken, owner, user]);

  return { sendUSDC, retryRecord, findOpenPayment, cancelPayment };
}
