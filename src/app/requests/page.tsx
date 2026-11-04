"use client";

import { Shell } from "@/components/Shell";
import { useState, useEffect } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { usePrivy } from "@privy-io/react-auth";
import { StatusBadge } from "@/features/requests/RequestBadges";
import { CreateRequestForm } from "@/features/requests/CreateRequestForm";
import { sendUSDC } from "@/features/send/sendUSDC";
import type { PaymentRequest } from "@/features/requests/createRequest";

export default function RequestsPage() {
  const { getAccessToken, user: privyUser } = usePrivy();
  const [tab, setTab] = useState<"incoming" | "outgoing">("incoming");
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchRequests() {
    setLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) return;
      const res = await fetch(`/api/requests?tab=${tab}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (res.ok) setRequests(body.requests ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => {
    (async () => { await fetchRequests(); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Realtime subscription on `requests` table for real-time updates.
  useEffect(() => {
    if (!privyUser) return;
    const db = getSupabaseBrowser();

    const channel = db
      .channel("requests-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "requests" },
        () => {
          fetchRequests();
        }
      )
      .subscribe();

    return () => {
      db.removeChannel(channel).catch(() => {});
    };
  }, [privyUser]);

  async function handlePay(request: PaymentRequest) {
    try {
      const token = await getAccessToken();
      await fetch(`/api/requests/${request.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "pay" }),
      });
      await sendUSDC("requester", request.amount, "Payment for request");
      fetchRequests();
    } catch (e) { console.error(e); }
  }

  async function handleDecline(request: PaymentRequest) {
    try {
      const token = await getAccessToken();
      await fetch(`/api/requests/${request.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "decline" }),
      });
      fetchRequests();
    } catch (e) { console.error(e); }
  }

  return (
    <Shell>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Requests</h1>
        <CreateRequestForm />

        <div className="flex gap-2">
          <button onClick={() => setTab("incoming")} className={`rounded px-4 py-2 ${tab === "incoming" ? "bg-blue-600 text-white" : "bg-zinc-200"}`}>Incoming</button>
          <button onClick={() => setTab("outgoing")} className={`rounded px-4 py-2 ${tab === "outgoing" ? "bg-blue-600 text-white" : "bg-zinc-200"}`}>Outgoing</button>
        </div>

        {loading ? <p>Loading...</p> : (
          <div className="space-y-3">
            {requests.length === 0 && <p className="text-zinc-500">No requests.</p>}
            {requests.map((r) => (
              <div key={r.id} className="rounded-xl border bg-white p-4 shadow">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{tab === "incoming" ? "From" : "To"}: {tab === "incoming" ? r.requester_id : r.payer_id}</p>
                    <p className="text-sm text-zinc-500">{r.amount} USDC</p>
                    {r.note && <p className="text-sm">{r.note}</p>}
                  </div>
                  <StatusBadge status={r.status} />
                </div>
                {tab === "incoming" && r.status === "pending" && (
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => handlePay(r)} className="rounded bg-emerald-600 px-3 py-1 text-sm text-white">Pay</button>
                    <button onClick={() => handleDecline(r)} className="rounded bg-rose-600 px-3 py-1 text-sm text-white">Decline</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}