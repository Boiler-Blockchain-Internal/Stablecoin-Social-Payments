"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { useCurrentUser } from "@/features/groups/useCurrentUser";

export type IncomingNotice = { id: string; username: string | null; amount: string };

/**
 * Live count of requests waiting on me to pay, plus the newest one that arrived while the app was
 * open, so the nav can badge Requests and pop a notice from any page.
 */
export function useIncomingRequests() {
  const { user } = useCurrentUser();
  const userId = user?.username ? user.id : null;
  const [count, setCount] = useState<{ userId: string; value: number } | null>(null);
  const [notice, setNotice] = useState<IncomingNotice | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getSupabaseBrowser().from("requests").select("id", { count: "exact", head: true })
      .eq("payer_id", userId).eq("status", "pending")
      .then(({ count: value, error }) => { if (!cancelled && !error) setCount({ userId, value: value ?? 0 }); });
    return () => { cancelled = true; };
  }, [userId, refresh]);

  useEffect(() => {
    if (!userId) return;
    const db = getSupabaseBrowser();
    // A fresh name per run: supabase-js reuses a same-named channel that may still be leaving.
    const channel = db.channel(`incoming-requests-${userId}-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "requests", filter: `payer_id=eq.${userId}` }, (payload) => {
        setRefresh((n) => n + 1);
        if (payload.eventType !== "INSERT") return;
        const row = payload.new as { id: string; requester_id: string; amount: number | string };
        db.from("users").select("username").eq("id", row.requester_id).maybeSingle()
          .then(({ data }) => setNotice({ id: row.id, username: data?.username ?? null, amount: String(row.amount) }));
      })
      .subscribe();
    return () => { db.removeChannel(channel).catch(() => {}); };
  }, [userId]);

  // Notices fade on their own.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  return {
    pending: count && count.userId === userId ? count.value : 0,
    notice,
    dismiss: () => setNotice(null),
  };
}
