"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { clearPaymentRecovery, PaymentSendError, usePaymentRecovery, useSendUSDC } from "@/features/send/sendUSDC";
import { CreateRequestForm } from "./CreateRequestForm";
import { StatusBadge, type RequestWithUsers } from "./RequestBadges";

type Tab = "incoming" | "outgoing";

export function RequestsInbox({ userId }: { userId: string }) {
  const { getAccessToken } = usePrivy();
  const { sendUSDC, retryRecord } = useSendUSDC();
  const recovery = usePaymentRecovery();
  const [tab, setTab] = useState<Tab>("incoming");
  const [loaded, setLoaded] = useState<{ tab: Tab; requests: RequestWithUsers[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("Session expired. Please log in again.");
        const res = await fetch(`/api/requests?tab=${tab}`, { headers: { Authorization: `Bearer ${token}` } });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Unable to load requests.");
        if (!cancelled) { setLoaded({ tab, requests: body.requests ?? [] }); setLoadError(null); }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Unable to load requests.");
      }
    })();
    return () => { cancelled = true; };
  }, [tab, refresh, getAccessToken]);

  // Live updates: refetch when a request involving me on this tab is created or answered.
  useEffect(() => {
    const db = getSupabaseBrowser();
    const column = tab === "incoming" ? "payer_id" : "requester_id";
    // A fresh name per run: supabase-js reuses a same-named channel that may still be leaving.
    const channel = db
      .channel(`requests-${column}-${userId}-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "requests", filter: `${column}=eq.${userId}` }, reload)
      .subscribe();
    return () => { db.removeChannel(channel).catch(() => {}); };
  }, [tab, userId, reload]);

  async function answer(r: RequestWithUsers, action: "pay" | "decline") {
    setBusyId(r.id);
    setActionError(null);
    let paymentRecovery = action === "pay" && recovery?.requestId === r.id ? recovery : null;
    let txHash: string | undefined;
    try {
      // Fail before any money moves if the session is gone.
      const token = await getAccessToken();
      if (!token) throw new Error("Session expired. Please log in again.");
      if (action === "pay") {
        if (!paymentRecovery) {
          if (!r.requester_username) throw new Error("This requester has no username yet.");
          try {
            const sent = await sendUSDC(r.requester_username, String(r.amount), r.note ?? undefined, { requestId: r.id });
            txHash = sent.txHash;
            paymentRecovery = { paymentId: sent.paymentId, txHash: sent.txHash, toUsername: r.requester_username, amount: String(r.amount), ...(r.note ? { note: r.note } : {}), requestId: r.id };
          } catch (error) {
            if (error instanceof PaymentSendError) {
              paymentRecovery = error.recovery;
            }
            throw error;
          }
        }
        if (!paymentRecovery.txHash) {
          throw new Error("The wallet did not return a transaction hash. Check wallet activity before trying again; no second transfer will be started.");
        }
        const recorded = await retryRecord(paymentRecovery);
        if (recorded.status !== "confirmed") throw new Error("Payment confirmation is still pending. Tap Pay again to check the same transaction; it will not send again.");
        txHash = paymentRecovery.txHash;
      }
      const res = await fetch(`/api/requests/${r.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, txHash }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Unable to update request.");
      if (paymentRecovery) clearPaymentRecovery(paymentRecovery.paymentId);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to update request.";
      setActionError(paymentRecovery?.requestId === r.id && paymentRecovery.txHash
        ? `Payment sent, but it couldn't be linked to this request: ${message} Tap Pay to retry without sending again.`
        : paymentRecovery?.txHash
          ? `Another payment needs reconciliation before paying this request: ${message} Open Send to check it; no new transfer was started.`
          : message);
    } finally {
      setBusyId(null);
      reload();
    }
  }

  const requests = loaded?.tab === tab ? loaded.requests : null;

  useEffect(() => {
    if (recovery?.requestId && requests?.some((request) => request.id === recovery.requestId && request.status === "paid")) {
      clearPaymentRecovery(recovery.paymentId);
    }
  }, [recovery, requests]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Requests</h1>
      <CreateRequestForm onCreated={() => (tab === "outgoing" ? reload() : setTab("outgoing"))} />

      <div className="flex gap-2" role="tablist">
        {(["incoming", "outgoing"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-2 capitalize ${tab === t ? "bg-blue-600 text-white" : "bg-zinc-200"}`}>{t}</button>
        ))}
      </div>

      {(actionError ?? loadError) && <p role="alert" className="text-sm text-red-600">{actionError ?? loadError}</p>}
      {!requests ? <p role="status" className="text-sm text-zinc-600">Loading requests…</p> : (
        <div className="space-y-3">
          {requests.length === 0 && <p className="text-zinc-500">No requests.</p>}
          {requests.map((r) => {
            const other = tab === "incoming" ? r.requester_username : r.payer_username;
            const hasPaymentInFlight = recovery?.requestId === r.id;
            return (
              <div key={r.id} className="rounded-xl border bg-white p-4 shadow">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{tab === "incoming" ? "From" : "To"} @{other ?? "unknown"}</p>
                    <p className="text-sm text-zinc-500">{r.amount} USDC</p>
                    {r.note && <p className="break-words text-sm">{r.note}</p>}
                  </div>
                  <StatusBadge status={r.status} />
                </div>
                {tab === "incoming" && r.status === "pending" && (
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => answer(r, "pay")} disabled={busyId !== null}
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white disabled:opacity-50">
                      {busyId === r.id ? "Working…" : `Pay ${r.amount} USDC`}
                    </button>
                    <button onClick={() => answer(r, "decline")} disabled={busyId !== null || hasPaymentInFlight}
                      className="rounded-lg bg-rose-600 px-4 py-2 text-sm text-white disabled:opacity-50">Decline</button>
                  </div>
                )}
                {tab === "incoming" && r.status === "pending" && hasPaymentInFlight && (
                  <p role="status" className="mt-2 text-xs text-amber-800">Reconcile this payment before declining the request.</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
