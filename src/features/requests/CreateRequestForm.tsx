"use client";

import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { UserPicker } from "@/features/auth/UserPicker";
import { createRequest } from "./createRequest";
import { AMOUNT_MAX, NOTE_MAX } from "./validation";

export function CreateRequestForm({ onCreated }: { onCreated?: () => void }) {
  const { getAccessToken } = usePrivy();
  const [toUsername, setToUsername] = useState("");
  const [amount, setAmount] = useState("1");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    setLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Session expired. Please log in again.");
      await createRequest(toUsername, amount, note, undefined, token);
      setStatus({ ok: true, text: `Requested ${amount} USDC from @${toUsername}.` });
      setToUsername("");
      setAmount("1");
      setNote("");
      onCreated?.();
    } catch (err) {
      setStatus({ ok: false, text: err instanceof Error ? err.message : "Failed." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border bg-white p-4 shadow">
      <h2 className="font-semibold">Request payment</h2>
      <UserPicker value={toUsername} onChange={setToUsername} label="From" placeholder="Search by username" />
      <div>
        <label htmlFor="request-amount" className="block text-sm font-medium">Amount (USDC)</label>
        <input id="request-amount" type="number" inputMode="decimal" min="0.000001" max={AMOUNT_MAX} step="any" required value={amount}
          onChange={(e) => setAmount(e.target.value)} className="w-full rounded-lg border border-zinc-300 px-3 py-2" />
      </div>
      <div>
        <label htmlFor="request-note" className="block text-sm font-medium">Note</label>
        <input id="request-note" type="text" maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)}
          className="w-full rounded-lg border border-zinc-300 px-3 py-2" placeholder="What's it for? (optional)" />
      </div>
      <button type="submit" disabled={loading || !toUsername} className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
        {loading ? "Sending…" : "Send request"}
      </button>
      {status && <p role={status.ok ? "status" : "alert"} className={`text-sm ${status.ok ? "text-emerald-700" : "text-red-600"}`}>{status.text}</p>}
    </form>
  );
}
