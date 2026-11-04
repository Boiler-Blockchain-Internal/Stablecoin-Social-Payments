"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useSmartWalletAddress } from "./useSmartWalletAddress";
import { useUsdcBalance } from "./useUsdcBalance";
import { UsdcFaucet } from "./UsdcFaucet";

export function WalletCard() {
  const { ready, authenticated } = usePrivy();
  const address = useSmartWalletAddress();
  const { balance, error: balanceError, refresh } = useUsdcBalance(address);

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
          {address ?? "Creating smart wallet…"}
        </p>
      </div>
      <div>
        <h2 className="text-sm font-medium text-zinc-500">USDC balance (Base Sepolia)</h2>
        <p className="text-3xl font-semibold" data-testid="usdc-balance">
          {balanceError ? "—" : balance === null ? "…" : `$${balance}`}
        </p>
        {balanceError && <p className="text-sm text-red-600">{balanceError}</p>}
        <button
          type="button"
          onClick={refresh}
          disabled={!address}
          className="mt-2 text-sm text-zinc-600 underline disabled:opacity-50"
        >
          Refresh
        </button>
      </div>
      <UsdcFaucet address={address} />
    </section>
  );
}
