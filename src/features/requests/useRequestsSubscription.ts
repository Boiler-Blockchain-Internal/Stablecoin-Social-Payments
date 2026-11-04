import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { useEffect, useState } from "react";
import type { PaymentRequest } from "./createRequest";

export function useRequestsSubscription(userId: string | null) {
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    const db = getSupabaseBrowser();
    const fetchInitial = async () => {
      const { data } = await db
        .from("requests")
        .select("*")
        .or(`requester_id.eq.${userId},payer_id.eq.${userId}`)
        .order("created_at", { ascending: false });
      if (data) setRequests(data as PaymentRequest[]);
      setLoading(false);
    };
    fetchInitial();

    const channel = db
      .channel("requests-inserts")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "requests" }, (payload) => {
        const newRow = payload.new as PaymentRequest;
        if (newRow.requester_id === userId || newRow.payer_id === userId) {
          setRequests((prev) => {
            const exists = prev.find((r) => r.id === newRow.id);
            if (exists) return prev;
            return [newRow, ...prev];
          });
        }
      })
      .subscribe();

    return () => {
      db.removeChannel(channel);
    };
  }, [userId]);

  return { requests, loading };
}
