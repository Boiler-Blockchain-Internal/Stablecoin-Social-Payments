"use client";

import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { decodeEventLog, erc20Abi, isHash, type Address, type Hash, type Hex } from "viem";
import { chain } from "@/lib/chain";
import { useSmartWalletAddress } from "@/features/auth/useSmartWalletAddress";
import {
  baseClient, burnAbi, burnFromWallet, CCTP_MESSAGE_TRANSMITTER, CCTP_TOKEN_MESSENGER,
  DEPOSIT_CHAINS, parseDepositAmount, receiveAbi, recipientBytes32, sourceClient,
  type DepositChain, type Eip1193Provider,
} from "./cctp";

type Recovery = {
  owner: string;
  source: DepositChain;
  recipient: Address;
  amount: string;
  burnHash: Hash;
  mintHash?: Hash;
};

const STORAGE_KEY = "stablepay:cctp-deposit:v1";
const storageKey = (owner: string) => `${STORAGE_KEY}:${owner}`;

function readRecovery(owner: string): Recovery | null {
  try {
    const item: unknown = JSON.parse(localStorage.getItem(storageKey(owner)) ?? "null");
    if (!item || typeof item !== "object") return null;
    const value = item as Partial<Recovery>;
    if (value.owner !== owner || (value.source !== "ethereum" && value.source !== "arc") ||
      !value.burnHash || !isHash(value.burnHash) || !value.recipient || !value.amount) return null;
    return value as Recovery;
  } catch { return null; }
}

function saveRecovery(item: Recovery) {
  localStorage.setItem(storageKey(item.owner), JSON.stringify(item));
}

function verifyMint(recipient: Address, logs: readonly { address: Address; topics: readonly Hex[]; data: Hex }[]) {
  return logs.some((log) => {
    if (log.address.toLowerCase() !== "0x036CbD53842c5426634e7929541eC2318f3dCF7e".toLowerCase() || !log.topics.length) return false;
    try {
      const event = decodeEventLog({ abi: erc20Abi, data: log.data, topics: [log.topics[0], ...log.topics.slice(1)] });
      return event.eventName === "Transfer" && event.args.from === "0x0000000000000000000000000000000000000000" &&
        event.args.to.toLowerCase() === recipient.toLowerCase() && event.args.value > BigInt(0);
    } catch { return false; }
  });
}

function verifyBurn(recovery: Recovery, logs: readonly { address: Address; topics: readonly Hex[]; data: Hex }[]) {
  const expectedAmount = parseDepositAmount(recovery.amount);
  const expectedRecipient = recipientBytes32(recovery.recipient).toLowerCase();
  const config = DEPOSIT_CHAINS[recovery.source];
  return logs.some((log) => {
    if (log.address.toLowerCase() !== CCTP_TOKEN_MESSENGER.toLowerCase() || !log.topics.length) return false;
    try {
      const decoded = decodeEventLog({ abi: burnAbi, data: log.data, topics: [log.topics[0], ...log.topics.slice(1)] });
      return decoded.eventName === "DepositForBurn" &&
        decoded.args.burnToken.toLowerCase() === config.usdc.toLowerCase() &&
        decoded.args.amount === expectedAmount &&
        decoded.args.destinationDomain === 6 &&
        decoded.args.mintRecipient.toLowerCase() === expectedRecipient;
    } catch { return false; }
  });
}

export function DepositScreen() {
  const { user, getAccessToken } = usePrivy();
  const { client } = useSmartWallets();
  const destination = useSmartWalletAddress();
  const [source, setSource] = useState<DepositChain>("ethereum");
  const [amount, setAmount] = useState("1");
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [completedHash, setCompletedHash] = useState<Hash | null>(null);

 useEffect(() => {
  let cancelled = false;

  Promise.resolve().then(() => {
    if (!cancelled) {
      setRecovery(user?.id ? readRecovery(user.id) : null);
    }
  });

  return () => {
    cancelled = true;
  };
}, [user?.id]);

  async function finish(item: Recovery) {
    if (!client || client.chain.id !== chain.id || !destination) throw new Error("Base Sepolia smart wallet is not ready.");
    if (item.recipient.toLowerCase() !== destination.toLowerCase()) throw new Error("This deposit belongs to another smart wallet.");
    setProgress("Checking source burn on-chain…");
    const receipt = await sourceClient(item.source).waitForTransactionReceipt({ hash: item.burnHash, timeout: 180_000 });
    if (receipt.status !== "success" || !verifyBurn(item, receipt.logs)) throw new Error("Burn receipt does not contain the expected CCTP deposit.");
    if (item.mintHash) {
      setProgress("Checking the destination mint…");
      const result = await baseClient.waitForTransactionReceipt({ hash: item.mintHash, timeout: 120_000 });
      if (result.status === "success" && verifyMint(item.recipient, result.logs)) {
        setCompletedHash(item.mintHash);
        setProgress("Deposit completed on Base Sepolia.");
        localStorage.removeItem(storageKey(item.owner));
        setRecovery(null);
        return;
      }
      throw new Error("Destination receipt did not show the expected USDC mint. Keep the burn hash to recover the deposit.");
    }
    setProgress("Checking Circle attestation (Standard transfers can take several minutes)…");
    const token = await getAccessToken();
    if (!token) throw new Error("Sign in to check your deposit.");
    const response = await fetch(`/api/deposits/attestation?source=${item.source}&hash=${item.burnHash}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    });
    const data = await response.json() as { status?: string; message?: Hex; attestation?: Hex; destinationMintTxHash?: Hash; error?: string };
    if (!response.ok) throw new Error(data.error || "Circle could not check your deposit.");
    if (data.status !== "complete" || !data.message || !data.attestation) {
      setProgress("Burn confirmed. Attestation pending — check again later; do not repeat the deposit.");
      return;
    }
    if (data.destinationMintTxHash && isHash(data.destinationMintTxHash)) {
      const next = { ...item, mintHash: data.destinationMintTxHash };
      saveRecovery(next); setRecovery(next);
      setProgress("Destination transaction found. Check status again to verify it.");
      return;
    }
    setProgress("Attestation ready. Approve the mint on Base Sepolia…");
    const { encodeFunctionData } = await import("viem");
    const mintHash = await client.sendTransaction({
      to: CCTP_MESSAGE_TRANSMITTER,
      data: encodeFunctionData({ abi: receiveAbi, functionName: "receiveMessage", args: [data.message, data.attestation] }),
      value: BigInt(0),
      chain,
    });
    const next = { ...item, mintHash };
    saveRecovery(next); setRecovery(next);
    setProgress("Waiting for the Base Sepolia mint…");
    const minted = await baseClient.waitForTransactionReceipt({ hash: mintHash, timeout: 120_000 });
    if (minted.status !== "success" || !verifyMint(item.recipient, minted.logs)) throw new Error("Destination receipt did not show the expected USDC mint; keep your burn hash for recovery.");
    setCompletedHash(mintHash);
    setProgress("Deposit completed on Base Sepolia.");
    localStorage.removeItem(storageKey(item.owner)); setRecovery(null);
  }

  async function run() {
    setBusy(true); setError(""); setCompletedHash(null);
    try {
      if (!user?.id || !destination) throw new Error("Log in and complete profile setup first.");
      if (recovery) { await finish(recovery); return; }
      parseDepositAmount(amount);
      const injected = (window as Window & { ethereum?: Eip1193Provider }).ethereum;
      if (!injected) throw new Error("Install or enable an EVM wallet extension to deposit from Ethereum or Arc.");
      const burnHash = await burnFromWallet(injected, source, destination, amount, setProgress);
      const pending: Recovery = { owner: user.id, source, recipient: destination, amount, burnHash };
      saveRecovery(pending); setRecovery(pending);
      await finish(pending);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The deposit could not be completed.");
    } finally { setBusy(false); }
  }

  return <div className="space-y-5">
    <div><h1 className="text-2xl font-semibold">Deposit USDC</h1><p className="mt-1 text-sm text-zinc-600">Bridge native test USDC into your StablePay wallet on Base Sepolia.</p></div>
    {recovery ? <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
      <p className="font-semibold">Deposit awaiting completion</p>
      <p>Source: {DEPOSIT_CHAINS[recovery.source].label} · {recovery.amount} USDC</p>
      <a className="break-all text-blue-700 underline" target="_blank" rel="noreferrer" href={`${DEPOSIT_CHAINS[recovery.source].chain.blockExplorers?.default.url}/tx/${recovery.burnHash}`}>View source burn transaction</a>
      <p>Do not start a second deposit until this one is resolved.</p>
    </div> : <div className="space-y-4 rounded-xl border border-zinc-200 bg-white p-4">
      <label className="block text-sm font-medium">Source network
        <select value={source} onChange={(event) => setSource(event.target.value as DepositChain)} disabled={busy}
          className="mt-2 w-full rounded-lg border border-zinc-300 p-3">
          <option value="ethereum">Ethereum Sepolia</option><option value="arc">Arc Testnet</option>
        </select>
      </label>
      <label className="block text-sm font-medium">USDC amount
        <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" disabled={busy}
          className="mt-2 w-full rounded-lg border border-zinc-300 p-3" placeholder="1.00" />
      </label>
      <div className="text-sm text-zinc-600"><p>Destination: Base Sepolia</p><p className="mt-1 break-all">Smart wallet: {destination || "Loading…"}</p></div>
      <p className="text-xs text-zinc-500">Standard CCTP V2; you pay source-network transaction fees. Requires native USDC and an EVM wallet on the source network. Solana support will come later.</p>
    </div>}
    <button type="button" onClick={run} disabled={busy || !destination || !client}
      className="w-full rounded-xl bg-blue-700 px-4 py-3 font-semibold text-white disabled:opacity-50">
      {busy ? "Working…" : recovery ? "Check / complete deposit" : "Deposit USDC"}
    </button>
    {progress && <p role="status" className="text-sm text-zinc-700">{progress}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {completedHash && <a className="text-sm text-blue-700 underline" target="_blank" rel="noreferrer" href={`https://sepolia.basescan.org/tx/${completedHash}`}>View completed mint on Base Sepolia</a>}
  </div>;
}
