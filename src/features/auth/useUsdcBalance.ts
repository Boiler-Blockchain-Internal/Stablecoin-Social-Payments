"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import type { Address } from "viem";
import { formatUsdcBalance, getUsdcBalance } from "@/lib/chain";
import { linkedSmartWalletAddress } from "./linkedSmartWallet";

export function useUsdcBalance(address: Address | undefined) {
  const { ready, authenticated, user } = usePrivy();
  const effectiveAddress = ready && authenticated ? linkedSmartWalletAddress(user, address) : undefined;
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<{ key: string; balance: string | null; error: string | null } | null>(null);
  const key = JSON.stringify([user?.id, effectiveAddress?.toLowerCase(), nonce]);
  const current = result?.key === key ? result : null;

  useEffect(() => {
    if (!effectiveAddress) return;
    let cancelled = false;
    getUsdcBalance(effectiveAddress).then(
      (units) => { if (!cancelled) setResult({ key, balance: formatUsdcBalance(units), error: null }); },
      () => { if (!cancelled) setResult({ key, balance: null, error: "Unable to load USDC balance. Please refresh to try again." }); },
    );
    return () => { cancelled = true; };
  }, [effectiveAddress, key]);

  const refresh = useCallback(() => setNonce((n) => n + 1), [setNonce]);
  return { balance: effectiveAddress ? current?.balance ?? null : null,
    error: effectiveAddress ? current?.error ?? null : null,
    loading: !!effectiveAddress && !current, refresh };
}
