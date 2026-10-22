
"use client";

import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import {
  encodeFunctionData,
  isAddress,
  type Address,
} from "viem";
import {
  chain,
  erc20Abi,
  USDC_ADDRESS,
  toUsdcUnits,
  fromUsdcUnits,
  getUsdcBalance,
  publicClient,
} from "@/lib/chain";

export default function TestSendPage() {
  const { authenticated, ready, login } = usePrivy();
  const { client } = useSmartWallets();

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("0.01");
  const [balance, setBalance] = useState("");
  const [hash, setHash] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const address = client?.account?.address;

  async function refreshBalance() {
    if (!address) return;
    const units = await getUsdcBalance(address);
    setBalance(fromUsdcUnits(units));
  }

  async function sendTestUSDC() {
    if (!client || !address) {
      setStatus("Smart wallet not ready.");
      return;
    }

    if (!isAddress(recipient)) {
      setStatus("Invalid recipient address.");
      return;
    }

    setLoading(true);
    setHash("");
    setStatus("Checking balance...");

    try {
      const units = toUsdcUnits(amount);

      if (units <= BigInt(0)) {
        throw new Error("Amount must be positive.");
      }

      const currentBalance = await getUsdcBalance(address);

      if (currentBalance < units) {
        throw new Error("Insufficient test USDC.");
      }

      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [recipient as Address, units],
      });

      setStatus("Submitting transaction...");

      const txHash = await client.sendTransaction({
        to: USDC_ADDRESS,
        data,
        value: BigInt(0),
        chain,
      });

      setHash(txHash);
      setStatus("Waiting for confirmation...");

      const receipt =
        await publicClient.waitForTransactionReceipt({
          hash: txHash,
          timeout: 120_000,
        });

      if (receipt.status !== "success") {
        throw new Error("Transaction reverted.");
      }

      setStatus("Transfer confirmed!");
      await refreshBalance();
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Transfer failed."
      );
    } finally {
      setLoading(false);
    }
  }

  if (!ready) return <main className="p-8">Loading...</main>;

  if (!authenticated) {
    return (
      <main className="p-8">
        <button onClick={login}>Log in with Privy</button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg space-y-5 p-8">
      <h1 className="text-2xl font-bold">
        Base Sepolia USDC Transfer Test
      </h1>

      <div>
        <p className="font-semibold">Smart wallet address</p>
        <p className="break-all text-sm">
          {address ?? "Initializing..."}
        </p>
      </div>

      <div>
        <p>Balance: {balance || "Not loaded"} USDC</p>
        <button
          onClick={refreshBalance}
          disabled={!address}
          className="rounded bg-gray-700 px-3 py-2 text-white"
        >
          Refresh balance
        </button>
      </div>

      <input
        className="w-full rounded border p-3"
        placeholder="Recipient 0x address"
        value={recipient}
        onChange={(e) => setRecipient(e.target.value)}
      />

      <input
        className="w-full rounded border p-3"
        placeholder="Amount in USDC"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />

      <button
        onClick={sendTestUSDC}
        disabled={loading || !client}
        className="rounded bg-blue-600 px-4 py-3 text-white disabled:opacity-50"
      >
        {loading ? "Processing..." : "Send Test USDC"}
      </button>

      <p>{status}</p>

      {hash && (
        <a
          className="break-all text-blue-500 underline"
          href={`https://sepolia.basescan.org/tx/${hash}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          View transaction: {hash}
        </a>
      )}
    </main>
  );
}
