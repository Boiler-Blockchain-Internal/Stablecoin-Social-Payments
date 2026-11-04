"use client";

import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

export type GroupsUser = { id: string; username: string | null };

/** The logged-in user's row in `users`, read with the browser client. */
export function useCurrentUser() {
  const { ready, authenticated, user: privyUser } = usePrivy();
  const privyId = privyUser?.id;
  const [result, setResult] = useState<{ privyId: string; user: GroupsUser | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!privyId) return;
    let cancelled = false;
    getSupabaseBrowser().from("users").select("id, username").eq("privy_id", privyId).maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        setResult({ privyId, user: data, error: error ? "Unable to load your profile." : null });
      });
    return () => { cancelled = true; };
  }, [privyId]);

  const current = result?.privyId === privyId ? result : null;
  return {
    ready: ready && (!authenticated || !privyId || current !== null),
    authenticated,
    user: current?.user ?? null,
    error: current?.error ?? null,
  };
}
