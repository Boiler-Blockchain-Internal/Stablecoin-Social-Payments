"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useSmartWalletAddress } from "./useSmartWalletAddress";
import { useUsdcBalance } from "./useUsdcBalance";

export function WalletCard() {
  const { ready, authenticated } = usePrivy();
  const address = useSmartWalletAddress();
  const { balance, error: balanceError, loading, refresh } = useUsdcBalance(address);

  if (!ready) return null;

  if (!authenticated) {
    return (
      <p className="text-center text-zinc-600">
        Log in with email or Google to see your wallet.
      </p>
    );
  }

  return (
    <section className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6">
      <div>
        <h2 className="text-sm font-medium text-zinc-500">Smart wallet</h2>
        <p className="break-all font-mono text-sm" data-testid="smart-wallet-address">
          {address ?? "Your smart wallet is not available yet. Please wait while Privy links it to your account."}
        </p>
      </div>
      <div>
        <h2 className="text-sm font-medium text-zinc-500">USDC balance (Base Sepolia)</h2>
        <p className="break-all text-3xl font-semibold" data-testid="usdc-balance" aria-live="polite">
          {!address ? "Wallet not ready" : balanceError ? "Balance unavailable" : loading ? "Loading balance…" : balance === null ? "—" : `${balance} USDC`}
        </p>
        {balanceError && <p role="alert" className="text-sm text-red-600">{balanceError}</p>}
        <button
          type="button"
          onClick={refresh}
          disabled={!address || loading}
          className="mt-2 text-sm text-zinc-600 underline disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
    </section>
  );
}
