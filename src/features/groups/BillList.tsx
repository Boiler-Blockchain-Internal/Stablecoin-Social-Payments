"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { StatusBadge } from "@/features/requests/RequestBadges";

type Bill = {
  id: string;
  description: string | null;
  total: number | string;
  created_at: string;
  payer: { username: string | null } | null;
  requests: {
    id: string;
    amount: number | string;
    status: "pending" | "paid" | "declined";
    users: { username: string | null } | null;
  }[];
};

const BILL_COLUMNS = `id, description, total, created_at,
  payer:users!splits_created_by_fkey(username),
  requests(id, amount, status, users!requests_payer_id_fkey(username))`;

export function BillList({ groupId }: { groupId: string }) {
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSupabaseBrowser().from("splits").select(BILL_COLUMNS).eq("group_id", groupId).order("created_at", { ascending: false })
      .then(({ data, error: loadError }) => {
        if (cancelled) return;
        if (loadError) { setError("Unable to load bills."); return; }
        setBills((data ?? []) as unknown as Bill[]);
      });
    return () => { cancelled = true; };
  }, [groupId]);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white">
      <h2 className="border-b border-zinc-200 px-4 py-3 text-sm font-medium text-zinc-600">Bills</h2>
      {error ? <p role="alert" className="px-4 py-3 text-sm text-red-600">{error}</p>
        : !bills ? <p role="status" className="px-4 py-3 text-sm text-zinc-600">Loading bills…</p>
        : bills.length === 0 ? <p className="px-4 py-3 text-sm text-zinc-600">No bills yet.</p>
        : (
          <ul className="divide-y divide-zinc-200">
            {bills.map((bill) => (
              <li key={bill.id} className="space-y-2 px-4 py-3">
                <div>
                  <p className="break-words font-medium">{bill.description}</p>
                  <p className="text-sm text-zinc-600">{String(bill.total)} USDC · paid by @{bill.payer?.username ?? "unknown"}</p>
                </div>
                <ul className="space-y-1">
                  {bill.requests.map((request) => (
                    <li key={request.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate">@{request.users?.username ?? "unknown"} · {String(request.amount)} USDC</span>
                      <StatusBadge status={request.status} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
