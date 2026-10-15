"use client";

import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import type { Address } from "viem";

export type AppUser = {
  id: string;
  privy_id: string;
  username: string | null;
  wallet_address: string | null;
  created_at: string;
};

/**
 * After login, once the smart wallet exists, upserts the user's row in Supabase
 * via POST /api/users/sync and returns it.
 */
export function useSyncUser(smartWalletAddress: Address | undefined) {
  const { authenticated, getAccessToken } = usePrivy();
  const [user, setUser] = useState<AppUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authenticated || !smartWalletAddress) return;
    let cancelled = false;

    (async () => {
      // Privy links the smart wallet to the user server-side shortly after it is created,
      // so retry a few times until the server sees it.
      for (let attempt = 0; attempt < 5 && !cancelled; attempt++) {
        try {
          const token = await getAccessToken();
          const res = await fetch("/api/users/sync", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          });
          const body = await res.json();
          if (!res.ok) throw new Error(body.error ?? res.statusText);
          if (cancelled) return;
          setUser(body.user);
          setError(null);
          if (body.user.wallet_address) return;
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : "Sync failed");
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authenticated, smartWalletAddress, getAccessToken]);

  return { user, error };
}
