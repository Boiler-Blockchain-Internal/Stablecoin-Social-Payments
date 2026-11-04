"use client";

import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { UserPicker } from "@/features/auth/UserPicker";

export function CreateRequestForm() {
  const { getAccessToken } = usePrivy();
  const [toUsername, setToUsername] = useState("");
  const [amount, setAmount] = useState("1");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("");
    setLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated.");
      // createRequest uses the API route with bearer token internally in production;
      // for now call via fetch to /api/requests
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ toUsername, amount, note }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed.");
      setStatus("Request sent!");
      setToUsername("");
      setAmount("1");
      setNote("");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border bg-white p-4 shadow">
      <h2 className="font-semibold">Request payment</h2>
      <div>
        <label className="text-xs font-medium text-zinc-500">To (username)</label>
        <UserPicker value={toUsername} onChange={setToUsername} placeholder="username" />
      </div>
      <div>
        <label className="text-xs font-medium text-zinc-500">Amount (USDC)</label>
        <input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full rounded border p-2" />
      </div>
      <div>
        <label className="text-xs font-medium text-zinc-500">Note</label>
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded border p-2" placeholder="Optional note" />
      </div>
      <button type="submit" disabled={loading} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">Send Request</button>
      {status && <p className="text-sm">{status}</p>}
    </form>
  );
}
