"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { fromUsdcUnits, getUsdcBalance } from "@/lib/chain";

export function useUsdcBalance(address: Address | undefined) {
  const [balance, setBalance] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    getUsdcBalance(address).then(
      (units) => {
        if (cancelled) return;
        setBalance(fromUsdcUnits(units));
        setError(null);
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to read balance");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [address, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  return { balance, error, refresh };
}
