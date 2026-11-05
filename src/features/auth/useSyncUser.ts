"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import type { Address } from "viem";

class SessionExpiredError extends Error {}

export type AppUser = {
  id: string;
  privy_id: string;
  username: string | null;
  wallet_address: string | null;
  created_at: string;
};

/** Mounted per Privy identity by ProfileGate; stale requests are cancelled. */
export function useSyncUser(smartWalletAddress: Address | undefined) {
  const { getAccessToken } = usePrivy();
  const [user, setUser] = useState<AppUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const retry = useCallback(() => {
    setLoading(true);
    setError(null);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      // Persist immediately; retry while Privy links a newly created wallet.
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const token = await getAccessToken();
          if (!token) throw new SessionExpiredError("Session expired. Please log in again.");
          const requestController = new AbortController();
          const cancelRequest = () => requestController.abort();
          controller.signal.addEventListener("abort", cancelRequest, { once: true });
          if (controller.signal.aborted) { cancelRequest(); return; }
          const timeout = setTimeout(cancelRequest, 15000);
          let res: Response;
          try { res = await fetch("/api/users/sync", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            signal: requestController.signal,
          }); } finally {
            clearTimeout(timeout);
            controller.signal.removeEventListener("abort", cancelRequest);
          }
          if (res.status === 401) throw new SessionExpiredError("Session expired. Please log in again.");
          const body = await res.json();
          if (!res.ok) throw new Error(body.error ?? "Profile sync failed.");
          if (controller.signal.aborted) return;
          // An in-flight wallet sync must not undo a username just saved by onboarding.
          setUser((previous) => ({ ...body.user, username: previous?.username ?? body.user.username }));
          setError(null);
          setLoading(false);
          if (!smartWalletAddress || body.user.wallet_address) return;
          if (attempt === 4) throw new Error("Wallet is still being linked. Retry profile sync shortly.");
        } catch (e) {
          if (controller.signal.aborted) return;
          if (attempt === 4 || e instanceof SessionExpiredError) {
            setError(e instanceof Error ? e.message : "Profile sync failed.");
            setLoading(false);
            return;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (controller.signal.aborted) return;
      }
    })();
    return () => controller.abort();
  }, [smartWalletAddress, getAccessToken, nonce]);

  return { user, error, loading, retry, setUser };
}
