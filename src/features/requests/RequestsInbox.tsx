"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { sendUSDC } from "@/features/send/sendUSDC";
import { CreateRequestForm } from "./CreateRequestForm";
import { StatusBadge, type RequestWithUsers } from "./RequestBadges";

type Tab = "incoming" | "outgoing";

export function RequestsInbox({ userId }: { userId: string }) {
  const { getAccessToken } = usePrivy();
  const [tab, setTab] = useState<Tab>("incoming");
  const [loaded, setLoaded] = useState<{ tab: Tab; requests: RequestWithUsers[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Transfers that went through but weren't recorded yet; retrying reuses the hash instead of paying twice.
  const [sentHashes, setSentHashes] = useState<Record<string, string>>({});
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
    let txHash = action === "pay" ? sentHashes[r.id] : undefined;
    try {
      // Fail before any money moves if the session is gone.
      const token = await getAccessToken();
      if (!token) throw new Error("Session expired. Please log in again.");
      if (action === "pay" && !txHash) {
        if (!r.requester_username) throw new Error("This requester has no username yet.");
        // Send first: the request is only marked paid once the transfer exists.
        ({ txHash } = await sendUSDC(r.requester_username, String(r.amount), r.note ?? undefined));
        const sent = txHash;
        setSentHashes((prev) => ({ ...prev, [r.id]: sent }));
      }
      const res = await fetch(`/api/requests/${r.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, txHash }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Unable to update request.");
      setSentHashes((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => id !== r.id)));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to update request.";
      setActionError(txHash ? `Payment sent, but it couldn't be recorded: ${message} Tap Pay to retry without sending again.` : message);
    } finally {
      setBusyId(null);
      reload();
    }
  }

  const requests = loaded?.tab === tab ? loaded.requests : null;

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
                    <button onClick={() => answer(r, "decline")} disabled={busyId !== null}
                      className="rounded-lg bg-rose-600 px-4 py-2 text-sm text-white disabled:opacity-50">Decline</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
