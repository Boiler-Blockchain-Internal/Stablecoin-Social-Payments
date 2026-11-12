"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { UserPicker, type SelectedUser } from "@/components/UserPicker";
import { toUsdcUnits } from "@/lib/chain";
import { useCurrentUser } from "@/features/groups/useCurrentUser";
import { useUsdcBalance } from "@/features/auth/useUsdcBalance";
import { useSmartWalletAddress } from "@/features/auth/useSmartWalletAddress";
import { clearPaymentRecovery, friendlySendError, usePaymentRecovery, useSendUSDC, type SendProgress } from "./sendUSDC";
import { NOTE_MAX, parseAmount } from "@/features/requests/validation";

const progressText: Record<SendProgress, string> = {
  preparing: "Preparing secure payment…",
  submitting: "Approve the transfer in Privy…",
  confirming: "Waiting for Base Sepolia confirmation…",
  recording: "Verifying and saving payment…",
};

export function SendScreen() {
  const { ready: privyReady, authenticated, login } = usePrivy();
  const { ready: profileReady, user, error: profileError } = useCurrentUser();
  // Only the current account's linked smart wallet (never a stale SDK client after an account switch).
  const address = useSmartWalletAddress();
  const { balance, error: balanceError, refresh } = useUsdcBalance(address);
  const { sendUSDC, retryRecord, findOpenPayment, cancelPayment } = useSendUSDC();
  const [recipient, setRecipient] = useState<SelectedUser | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<SendProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ username: string; amount: string; txHash: string } | null>(null);
  const recovery = usePaymentRecovery();
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [manualRecoveryHash, setManualRecoveryHash] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!authenticated || recovery) return;
    let cancelled = false;
    findOpenPayment().catch((cause) => {
      if (!cancelled) setError(friendlySendError(cause));
    });
    return () => { cancelled = true; };
  }, [authenticated, findOpenPayment, recovery]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (recovery) {
      setError("Reconcile the earlier payment before starting another one.");
      return;
    }
    if (!recipient) {
      setError("Choose a recipient from the username search results.");
      return;
    }
    if (!parseAmount(amount)) {
      setError("Enter an amount greater than 0 with no more than 6 decimal places.");
      return;
    }
    if (note.trim().length > NOTE_MAX) {
      setError(`Notes must be ${NOTE_MAX} characters or fewer.`);
      return;
    }
    setBusy(true);
    setProgress("preparing");
    try {
      const result = await sendUSDC(recipient.username, amount, note, { onProgress: setProgress });
      setSuccess({ username: recipient.username, amount, txHash: result.txHash });
      setAmount("");
      setNote("");
      refresh();
    } catch (cause) {
      setError(friendlySendError(cause));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function reconcile() {
    if (!recovery) return;
    const txHash = recovery.txHash ?? manualRecoveryHash.trim();
    if (!txHash) {
      setError("Paste the transaction hash from Privy or wallet activity to reconcile this payment.");
      return;
    }
    setRecoveryBusy(true);
    setError(null);
    try {
      const result = await retryRecord(recovery, txHash);
      if (result.status === "confirmed") {
        clearPaymentRecovery(recovery.paymentId);
        setSuccess({ username: recovery.toUsername, amount: recovery.amount, txHash });
        refresh();
      } else if (result.status === "failed") {
        clearPaymentRecovery(recovery.paymentId);
        setError("The transfer failed on Base Sepolia. No USDC was transferred.");
      } else {
        setError("The chain has not confirmed this transfer yet. Check again shortly; do not send another payment.");
      }
    } catch (cause) {
      setError(friendlySendError(cause));
    } finally {
      setRecoveryBusy(false);
    }
  }

  async function cancel() {
    if (!recovery) return;
    setRecoveryBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await cancelPayment(recovery);
      if (result?.status === "confirmed") {
        setSuccess({ username: recovery.toUsername, amount: recovery.amount, txHash: result.tx_hash ?? "" });
        refresh();
      } else if (result?.status === "failed") {
        setNotice("Payment cancelled. Nothing was sent.");
      } else {
        setError("A matching transfer is still confirming. Check again shortly.");
      }
    } catch (cause) {
      setError(friendlySendError(cause));
    } finally {
      setRecoveryBusy(false);
    }
  }

  const parsedAmount = parseAmount(amount);
  const balanceLabel = balance === null ? null : Number(balance).toLocaleString(undefined, { maximumFractionDigits: 6 });
  const insufficientBalance = !!parsedAmount && balance !== null && (() => {
    try { return toUsdcUnits(balance) < toUsdcUnits(parsedAmount); } catch { return true; }
  })();

  if (!privyReady || (authenticated && !profileReady)) {
    return <p role="status" className="py-16 text-center text-sm text-zinc-500">Loading your wallet…</p>;
  }
  if (!authenticated) {
    return (
      <section className="rounded-3xl border border-zinc-200 bg-white px-6 py-12 text-center shadow-sm sm:px-10">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">StablePay · Base Sepolia</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Send USDC to a friend</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-zinc-600">Sign in to find someone by username and send a test USDC payment.</p>
        <button type="button" onClick={login} className="mt-7 rounded-xl bg-zinc-900 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-zinc-700">Log in to continue</button>
      </section>
    );
  }
  if (profileError) return <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{profileError}</p>;
  if (!user?.username) {
    return <p className="rounded-2xl border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-600">Finish setting up your username on the <Link href="/" className="font-medium underline">profile page</Link> before sending.</p>;
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-950 via-emerald-900 to-teal-800 px-6 py-7 text-white shadow-sm sm:px-8 sm:py-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200">StablePay · Base Sepolia</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Send USDC</h1>
            <p className="mt-2 max-w-sm text-sm leading-6 text-emerald-100">A quick, direct payment to someone you know.</p>
          </div>
          <div aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-2xl border border-white/15 bg-white/10 text-xl font-semibold">$</div>
        </div>
        <div className="mt-7 flex items-end justify-between gap-3 border-t border-white/15 pt-4">
          <div>
            <p className="text-xs text-emerald-200">Available balance</p>
            <p className="mt-1 text-2xl font-semibold">{balanceLabel === null ? "—" : `${balanceLabel} USDC`}</p>
          </div>
          <button type="button" onClick={refresh} disabled={!address} className="rounded-lg border border-white/20 px-3 py-2 text-xs font-medium text-white hover:bg-white/10 disabled:opacity-50">Refresh</button>
        </div>
        {balanceError && <p role="alert" className="mt-3 text-xs text-amber-200">Your USDC balance could not be loaded. {balanceError}</p>}
        {address ? <p className="mt-3 break-all font-mono text-[11px] text-emerald-200/80">Smart wallet · {address}</p> : <p role="status" className="mt-3 text-xs text-emerald-200">Initializing your smart wallet…</p>}
      </section>

      {notice && <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>}
      {recovery && (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 sm:p-5">
          <p className="text-sm font-semibold text-amber-950">A payment needs attention</p>
          <p className="mt-1 text-sm leading-5 text-amber-900">{recovery.txHash ? "A transfer was submitted. Recheck the same transaction to finish saving it; this will not send USDC again." : "Another payment is blocked while this one is unresolved. If the page closed before saving its hash, find the transaction in Privy or wallet activity and enter the hash below. The server verifies it before changing the record."}</p>
          {recovery.txHash ? <p className="mt-3 break-all font-mono text-xs text-amber-900">{recovery.txHash}</p> : (
            <label className="mt-3 block text-xs font-medium text-amber-950" htmlFor="recovery-hash">
              Base Sepolia transaction hash
              <input id="recovery-hash" type="text" inputMode="text" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                placeholder="0x…" value={manualRecoveryHash} disabled={recoveryBusy}
                onChange={(event) => setManualRecoveryHash(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-lg border border-amber-300 bg-white px-3 font-mono text-xs text-zinc-900 outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-50" />
            </label>
          )}
          {recovery.requestId ? <Link href="/requests" className="mt-4 inline-block text-sm font-semibold text-amber-950 underline">Open Requests</Link> : null}
          <button type="button" onClick={reconcile} disabled={recoveryBusy || (!recovery.txHash && !manualRecoveryHash.trim())}
            className="mt-4 min-h-11 w-full rounded-xl bg-amber-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
            {recoveryBusy ? "Checking transaction…" : recovery.txHash ? "Retry payment recording" : "Verify transaction hash"}
          </button>
          {!recovery.txHash && (
            <button type="button" onClick={cancel} disabled={recoveryBusy}
              className="mt-2 min-h-11 w-full rounded-xl border border-amber-400 px-4 py-3 text-sm font-semibold text-amber-950 disabled:opacity-50">
              I never approved it, cancel this payment
            </button>
          )}
        </section>
      )}

      <form onSubmit={submit} className="space-y-5 rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-7">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">Payment details</p>
          <h2 className="mt-1 text-lg font-semibold">Who are you paying?</h2>
        </div>
        <UserPicker selectedUser={recipient} onSelect={setRecipient} label="Recipient" placeholder="Search usernames" disabled={busy || !!recovery} />

        <div className="space-y-2">
          <label htmlFor="send-amount" className="block text-sm font-medium">Amount</label>
          <div className="relative">
            <input id="send-amount" inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount} disabled={busy || !!recovery}
              onChange={(event) => setAmount(event.target.value)} aria-describedby="send-amount-help"
              className="min-h-16 w-full rounded-2xl border border-zinc-300 bg-zinc-50 px-4 pr-20 text-3xl font-semibold tracking-tight outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-2 focus:ring-emerald-100 disabled:opacity-50" />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-zinc-500">USDC</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {["5", "10", "25"].map((value) => <button key={value} type="button" disabled={busy || !!recovery} onClick={() => setAmount(value)} className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:border-emerald-700 hover:text-emerald-800 disabled:opacity-50">${value}</button>)}
          </div>
          <p id="send-amount-help" className="text-xs text-zinc-500">Up to 10,000 USDC · 6 decimal places maximum</p>
          {amount && !parsedAmount && <p className="text-xs text-red-600">Enter a valid positive amount with up to 6 decimal places.</p>}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="send-note" className="text-sm font-medium">Note <span className="font-normal text-zinc-400">(optional)</span></label>
            <span className="text-xs text-zinc-400">{note.length}/{NOTE_MAX}</span>
          </div>
          <textarea id="send-note" rows={3} maxLength={NOTE_MAX} placeholder="What’s this for?" value={note} disabled={busy || !!recovery} onChange={(event) => setNote(event.target.value)} className="w-full resize-y rounded-xl border border-zinc-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100 disabled:opacity-50" />
        </div>

        {recipient && parsedAmount && (
          <div className="rounded-xl bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
            <span className="font-medium text-zinc-900">{amount} USDC</span> to <span className="font-medium text-zinc-900">@{recipient.username}</span>
            {note.trim() && <p className="mt-1 break-words text-xs text-zinc-500">“{note.trim()}”</p>}
          </div>
        )}

        {(error || success) && <div role={error ? "alert" : "status"} className={`rounded-xl px-4 py-3 text-sm ${error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>
          {error ? error : <>Sent {success?.amount} USDC to <span className="font-semibold">@{success?.username}</span>.</>}
          {success && <a className="mt-2 block break-all text-xs underline" href={`https://sepolia.basescan.org/tx/${success.txHash}`} target="_blank" rel="noopener noreferrer">View on Base Sepolia Explorer</a>}
        </div>}

        {busy && <p role="status" className="text-center text-xs font-medium text-zinc-500">{progress ? progressText[progress] : "Processing payment…"}</p>}
        {insufficientBalance && <p role="alert" className="text-center text-xs text-red-600">Your balance is too low for this amount.</p>}
        <button type="submit" disabled={busy || !!recovery || !address || !recipient || !parsedAmount || !!balanceError || balance === null || insufficientBalance}
          className="min-h-12 w-full rounded-xl bg-emerald-800 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? "Sending securely…" : recovery ? "Resolve payment above" : "Send payment"}
        </button>
        <p className="text-center text-[11px] leading-5 text-zinc-400">Transfers use your Privy smart wallet on Base Sepolia. Sponsorship depends on the app’s Privy paymaster configuration.</p>
      </form>
    </div>
  );
}
