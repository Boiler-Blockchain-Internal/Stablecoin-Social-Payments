"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { encodeFunctionData, isHash, type Hash, type Hex } from "viem";
import { chain } from "@/lib/chain";
import { useSmartWalletAddress } from "@/features/auth/useSmartWalletAddress";
import {
  baseClient, burnFromWallet, CCTP_MESSAGE_TRANSMITTER, DEPOSIT_CHAINS, isDepositChain, parseDepositAmount, receiveAbi,
  type DepositChain, type Eip1193Provider,
} from "./cctp";

/** A burn the browser knows about; the server is the source of truth once it has recorded it. */
type Pending = { owner: string; source: DepositChain; amount: string; burnHash: Hash; mintHash?: Hash };
type Progress =
  | { status: "burning" }
  | { status: "attesting" }
  | { status: "ready"; message: Hex; attestation: Hex }
  | { status: "completed"; deposit: { mint_tx_hash: string | null } };

const storageKey = (owner: string) => `stablepay:cctp-deposit:v1:${owner}`;
const POLL_MS = 5_000;
// Keep checking while the page is open for about 4 minutes (Arc attests in seconds; Ethereum takes ~15–20 min).
const MAX_POLLS = 48;

function readPending(owner: string): Pending | null {
  try {
    const item = JSON.parse(localStorage.getItem(storageKey(owner)) ?? "null") as Partial<Pending> | null;
    if (!item || item.owner !== owner || !isDepositChain(item.source) || !item.burnHash || !isHash(item.burnHash) || !item.amount) return null;
    return item as Pending;
  } catch { return null; }
}
function savePending(item: Pending) {
  try { localStorage.setItem(storageKey(item.owner), JSON.stringify(item)); } catch { /* The server copy still allows recovery. */ }
}
function clearPending(owner: string) {
  try { localStorage.removeItem(storageKey(owner)); } catch { /* Nothing to clear. */ }
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function DepositScreen() {
  const { ready, authenticated, user, getAccessToken, login } = usePrivy();
  const { client } = useSmartWallets();
  const destination = useSmartWalletAddress();
  const owner = user?.id ?? null;
  const [source, setSource] = useState<DepositChain>("arc");
  const [amount, setAmount] = useState("1");
  const [pending, setPending] = useState<Pending | null>(null);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState<{ amount: string; mintHash: string | null } | null>(null);

  const api = useCallback(async (method: "GET" | "POST", body?: unknown) => {
    const token = await getAccessToken();
    if (!token) throw new Error("Session expired. Please log in again.");
    const response = await fetch("/api/deposits", {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? "Couldn't check the deposit.");
    return data;
  }, [getAccessToken]);

  // Resume an unfinished deposit: this browser's copy first, else the server's (any device).
  useEffect(() => {
    if (!owner) return;
    let cancelled = false;
    (async () => {
      const local = readPending(owner);
      if (local) { if (!cancelled) setPending(local); return; }
      try {
        const { deposits } = await api("GET") as { deposits: { source: DepositChain; amount: string; burn_tx_hash: Hash; status: string }[] };
        const open = deposits.find((d) => d.status === "pending");
        if (!cancelled && open) setPending({ owner, source: open.source, amount: String(open.amount), burnHash: open.burn_tx_hash });
      } catch { /* Offline or not set up yet; the form still works. */ }
    })();
    return () => { cancelled = true; };
  }, [owner, api]);

  async function finish(item: Pending) {
    let current = item;
    let mintedOnce = false;
    for (let poll = 0; poll < MAX_POLLS; poll++) {
      const next = await api("POST", { source: current.source, burnHash: current.burnHash, mintHash: current.mintHash }) as Progress;
      if (next.status === "completed") {
        clearPending(current.owner);
        setPending(null);
        setCompleted({ amount: current.amount, mintHash: next.deposit.mint_tx_hash ?? current.mintHash ?? null });
        setProgress("");
        return;
      }
      if (next.status === "ready" && !mintedOnce) {
        if (!client || client.chain.id !== chain.id) throw new Error("Your Base Sepolia smart wallet isn't ready yet. Try again in a moment.");
        setProgress("Attestation ready. Minting your USDC on Base Sepolia…");
        mintedOnce = true;
        try {
          const mintHash = await client.sendTransaction({
            to: CCTP_MESSAGE_TRANSMITTER,
            data: encodeFunctionData({ abi: receiveAbi, functionName: "receiveMessage", args: [next.message, next.attestation] }),
            value: BigInt(0),
            chain,
          });
          current = { ...current, mintHash };
          savePending(current);
          setPending(current);
          await baseClient.waitForTransactionReceipt({ hash: mintHash, timeout: 120_000 });
        } catch (cause) {
          // Someone else may have minted it first; the next check tells us.
          const minted = await api("POST", { source: current.source, burnHash: current.burnHash }) as Progress;
          if (minted.status === "completed") continue;
          throw cause;
        }
        continue;
      }
      setProgress(next.status === "burning"
        ? "Waiting for your burn to confirm on the source network…"
        : `Waiting for Circle to attest the burn (${current.source === "arc" ? "usually seconds on Arc" : "about 15–20 minutes from Ethereum Sepolia"}). You can leave this page; the deposit is saved.`);
      await sleep(POLL_MS);
    }
    setProgress("Still waiting on Circle. Your deposit is saved; come back later and tap Check deposit.");
  }

  async function run() {
    setBusy(true); setError(""); setCompleted(null);
    try {
      if (!owner || !destination) throw new Error("Log in and finish profile setup first.");
      if (pending) { await finish(pending); return; }
      parseDepositAmount(amount);
      const injected = (window as Window & { ethereum?: Eip1193Provider }).ethereum;
      if (!injected) {
        throw new Error("Deposits need a browser wallet such as MetaMask holding USDC on the source network. On a phone, open StablePay in MetaMask's built-in browser.");
      }
      const burnHash = await burnFromWallet(injected, source, destination, amount, setProgress);
      const item: Pending = { owner, source, amount, burnHash };
      savePending(item);
      setPending(item);
      await finish(item);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The deposit could not be completed.");
    } finally { setBusy(false); }
  }

  if (!ready) return <p role="status" className="py-16 text-center text-sm text-zinc-500">Loading…</p>;
  if (!authenticated) {
    return (
      <div className="space-y-4 py-10 text-center">
        <h1 className="text-2xl font-semibold">Deposit USDC</h1>
        <p className="text-sm text-zinc-600">Log in to bring test USDC from Ethereum Sepolia or Arc into your StablePay wallet.</p>
        <button type="button" onClick={login} className="rounded-xl bg-zinc-900 px-6 py-3 text-sm font-semibold text-white">Log in</button>
      </div>
    );
  }

  const config = pending ? DEPOSIT_CHAINS[pending.source] : null;
  return <div className="space-y-5">
    <div>
      <h1 className="text-2xl font-semibold">Deposit USDC</h1>
      <p className="mt-1 text-sm text-zinc-600">Bring test USDC from another network into your StablePay wallet on Base Sepolia. It arrives as regular USDC you can send, request and split.</p>
    </div>
    {pending && config ? <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
      <p className="font-semibold">Deposit in progress</p>
      <p>From {config.label} · {pending.amount} USDC</p>
      <a className="break-all text-blue-700 underline" target="_blank" rel="noreferrer" href={`${config.chain.blockExplorers?.default.url}/tx/${pending.burnHash}`}>View the burn on {config.label}</a>
      <p>Don&apos;t start another deposit until this one finishes; the USDC has already left your source wallet.</p>
    </div> : <div className="space-y-4 rounded-xl border border-zinc-200 bg-white p-4">
      <label className="block text-sm font-medium">From network
        <select value={source} onChange={(event) => setSource(event.target.value as DepositChain)} disabled={busy}
          className="mt-2 w-full rounded-lg border border-zinc-300 p-3">
          <option value="arc">Arc Testnet (arrives in about a minute)</option>
          <option value="ethereum">Ethereum Sepolia (about 15–20 minutes)</option>
        </select>
      </label>
      <label className="block text-sm font-medium">USDC amount
        <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" disabled={busy}
          className="mt-2 w-full rounded-lg border border-zinc-300 p-3" placeholder="1.00" />
      </label>
      <div className="text-sm text-zinc-600"><p>To: your StablePay wallet on Base Sepolia</p><p className="mt-1 break-all font-mono text-xs">{destination || "Loading…"}</p></div>
      <p className="text-xs text-zinc-500">Uses Circle CCTP (Standard, no bridge fee). You approve and burn in your browser wallet and pay that network&apos;s gas{source === "arc" ? " (Arc gas is paid in USDC, so keep a little extra)" : " (Sepolia ETH)"}. The mint on Base is sponsored.</p>
    </div>}
    <button type="button" onClick={run} disabled={busy || !destination || !client}
      className="w-full rounded-xl bg-blue-700 px-4 py-3 font-semibold text-white disabled:opacity-50">
      {busy ? "Working…" : pending ? "Check deposit" : "Deposit USDC"}
    </button>
    {progress && <p role="status" className="text-sm text-zinc-700">{progress}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {completed && <div role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">
      <p className="font-semibold">Deposited {completed.amount} USDC to your StablePay wallet.</p>
      {completed.mintHash && <a className="mt-1 block break-all underline" target="_blank" rel="noreferrer" href={`https://sepolia.basescan.org/tx/${completed.mintHash}`}>View the mint on Base Sepolia</a>}
    </div>}
  </div>;
}
