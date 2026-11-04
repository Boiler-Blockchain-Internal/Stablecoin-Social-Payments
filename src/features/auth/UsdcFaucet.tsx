"use client";

import { useId, useState } from "react";
import type { Address } from "viem";

export function UsdcFaucet({ address }: { address: Address | undefined }) {
  // Reset copy feedback, including pending clipboard results, when wallets change.
  return <FaucetControls key={address?.toLowerCase() ?? "no-wallet"} address={address} />;
}

function FaucetControls({ address }: { address: Address | undefined }) {
  const id = useId();
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "error">("idle");
  async function copyAddress() {
    if (!address || status === "copying") return;
    setStatus("copying");
    try {
      await navigator.clipboard.writeText(address);
      setStatus("copied");
    } catch { setStatus("error"); }
  }
  return <section aria-labelledby={id} className="space-y-3 border-t border-zinc-200 pt-4">
    <h3 id={id} className="font-semibold">Get test USDC</h3>
    <p className="text-sm text-zinc-600">Base Sepolia testnet only. Test USDC is not real money and has no financial value.</p>
    <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-600">
      <li>Copy your smart-wallet address shown above.</li>
      <li>Open Circle and select <strong>USDC</strong> and <strong>Base Sepolia</strong>.</li>
      <li>Paste the address and complete Circle’s checks. Return here and refresh your balance after the funds arrive.</li>
    </ol>
    {!address && <p role="status" className="text-sm text-zinc-500">Wait for your smart wallet before requesting test funds.</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={!address || status === "copying"} onClick={copyAddress}
        className="rounded-lg border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50">
        {status === "copying" ? "Copying…" : "Copy wallet address"}
      </button>
      {address && <a href="https://faucet.circle.com/" target="_blank" rel="noopener noreferrer"
        className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700">
        Get Test USDC <span className="sr-only">(opens in a new tab)</span>
      </a>}
    </div>
    {status === "copied" && <p role="status" className="text-sm text-zinc-600">Wallet address copied.</p>}
    {status === "error" && <p role="alert" className="text-sm text-red-600">Couldn’t copy automatically. Select the wallet address above and copy it manually.</p>}
  </section>;
}
