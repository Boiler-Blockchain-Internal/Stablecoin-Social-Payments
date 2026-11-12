"use client";

import Link from "next/link";
import { useId, useState } from "react";
import type { Address } from "viem";

// Networks Circle's faucet serves that StablePay can use: Base Sepolia directly, the others via CCTP Deposit.
type FaucetNetwork = "base" | "arc" | "ethereum";
const NETWORKS: Record<FaucetNetwork, { label: string; hint: string; direct: boolean; timing?: string; gasNote?: string }> = {
  base: { label: "Base Sepolia", hint: "Straight to StablePay", direct: true },
  arc: { label: "Arc Testnet", hint: "Then Deposit", direct: false, timing: "about a minute", gasNote: "Arc fees are paid in USDC, so keep a little extra." },
  ethereum: { label: "Ethereum Sepolia", hint: "Then Deposit", direct: false, timing: "about 15–20 minutes", gasNote: "You’ll also need a little Sepolia ETH for fees." },
};

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
  const [network, setNetwork] = useState<FaucetNetwork>("base");
  const option = NETWORKS[network];
  return <section aria-labelledby={id} className="space-y-3 border-t border-zinc-200 pt-4">
    <h3 id={id} className="font-semibold">Get test USDC</h3>
    <p className="text-sm text-zinc-600">Testnet only. Test USDC is not real money and has no financial value.</p>
    <fieldset>
      <legend className="text-sm font-medium">Which network?</legend>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {(Object.keys(NETWORKS) as FaucetNetwork[]).map((key) => (
          <label key={key} className={`cursor-pointer rounded-lg border px-2 py-2 text-center text-xs font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-zinc-400 ${network === key ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 text-zinc-700"}`}>
            <input type="radio" name={`${id}-network`} value={key} checked={network === key} onChange={() => setNetwork(key)} className="sr-only" />
            {NETWORKS[key].label}
            <span className={`block font-normal ${network === key ? "text-zinc-300" : "text-zinc-500"}`}>{NETWORKS[key].hint}</span>
          </label>
        ))}
      </div>
    </fieldset>
    {option.direct ? (
      <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-600">
        <li>Copy your smart-wallet address shown above.</li>
        <li>Open Circle and select <strong>USDC</strong> and <strong>Base Sepolia</strong>.</li>
        <li>Paste the address and complete Circle’s checks. Return here and refresh your balance after the funds arrive.</li>
      </ol>
    ) : (
      <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-600">
        <li>Open Circle and select <strong>USDC</strong> and <strong>{option.label}</strong>.</li>
        <li>Paste your <strong>browser wallet</strong> address (e.g. MetaMask), not the StablePay address above.</li>
        <li>Then use <strong>Deposit</strong> to bring it into StablePay ({option.timing}).{option.gasNote ? ` ${option.gasNote}` : ""}</li>
      </ol>
    )}
    {option.direct && !address && <p role="status" className="text-sm text-zinc-500">Wait for your smart wallet before requesting test funds.</p>}
    <div className="flex flex-wrap gap-2">
      {option.direct && <button type="button" disabled={!address || status === "copying"} onClick={copyAddress}
        className="rounded-lg border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50">
        {status === "copying" ? "Copying…" : "Copy wallet address"}
      </button>}
      {(address || !option.direct) && <a href="https://faucet.circle.com/" target="_blank" rel="noopener noreferrer"
        className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700">
        Open Circle faucet <span className="sr-only">(opens in a new tab)</span>
      </a>}
      {!option.direct && <Link href={`/deposit?source=${network}`}
        className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-50">
        Deposit from {option.label}
      </Link>}
    </div>
    {option.direct && status === "copied" && <p role="status" className="text-sm text-zinc-600">Wallet address copied.</p>}
    {option.direct && status === "error" && <p role="alert" className="text-sm text-red-600">Couldn’t copy automatically. Select the wallet address above and copy it manually.</p>}
  </section>;
}
