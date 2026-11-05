"use client";

import { useState, type FormEvent } from "react";
import { fromUsdcUnits, toUsdcUnits } from "@/lib/chain";
import { NOTE_MAX, parseAmount } from "@/features/requests/validation";
import { splitEvenly, sumUnits } from "./splits";

type Member = { user_id: string; username: string | null };
type Mode = "even" | "custom";

function toUnits(value: string): bigint | null {
  const amount = parseAmount(value);
  return amount ? toUsdcUnits(amount) : null;
}

export function AddBillForm({ members, myId, submit, onAdded }: {
  members: Member[];
  myId: string;
  submit: (body: unknown) => Promise<unknown>;
  onAdded: () => void;
}) {
  const [description, setDescription] = useState("");
  const [total, setTotal] = useState("");
  const [mode, setMode] = useState<Mode>("even");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalUnits = toUnits(total);
  const evenShares = totalUnits === null ? [] : splitEvenly(totalUnits, members.map((m) => m.user_id));
  const entered = members.flatMap((m) => (amounts[m.user_id]?.trim() ? [{ userId: m.user_id, amount: amounts[m.user_id].trim() }] : []));
  const enteredUnits = entered.map((share) => toUnits(share.amount));
  const allAmountsValid = enteredUnits.every((units) => units !== null);
  const left = totalUnits !== null && allAmountsValid ? totalUnits - sumUnits(enteredUnits as bigint[]) : null;
  const ready = description.trim() !== "" && totalUnits !== null && (mode === "even" || left === BigInt(0));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !ready) return;
    setSaving(true);
    setError(null);
    try {
      await submit({
        description: description.trim(),
        total: total.trim(),
        mode,
        ...(mode === "custom" ? { shares: entered } : {}),
      });
      setDescription("");
      setTotal("");
      setAmounts({});
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to add bill. Please try again.");
    } finally { setSaving(false); }
  }

  const name = (member: Member) => (member.user_id === myId ? "You" : `@${member.username ?? "unknown"}`);

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4" aria-busy={saving}>
      <h2 className="text-sm font-medium text-zinc-600">Add a bill you paid</h2>
      <div className="space-y-1">
        <label htmlFor="bill-description" className="block text-sm font-medium">What was it for?</label>
        <input id="bill-description" value={description} onChange={(e) => { setDescription(e.target.value); setError(null); }}
          maxLength={NOTE_MAX} disabled={saving} placeholder="Dinner"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 focus:outline-2 focus:outline-zinc-900 disabled:opacity-50" />
      </div>
      <div className="space-y-1">
        <label htmlFor="bill-total" className="block text-sm font-medium">Total (USDC)</label>
        <input id="bill-total" value={total} onChange={(e) => { setTotal(e.target.value); setError(null); }}
          inputMode="decimal" autoComplete="off" disabled={saving} placeholder="0.00"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 focus:outline-2 focus:outline-zinc-900 disabled:opacity-50" />
      </div>

      <div role="group" aria-label="How to split" className="grid grid-cols-2 gap-2">
        {(["even", "custom"] as const).map((option) => (
          <button key={option} type="button" onClick={() => { setMode(option); setError(null); }} disabled={saving}
            aria-pressed={mode === option}
            className={`min-h-11 rounded-lg border text-sm font-medium capitalize disabled:opacity-50 ${mode === option ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 hover:bg-zinc-100"}`}>
            {option}
          </button>
        ))}
      </div>

      <ul className="divide-y divide-zinc-200">
        {members.map((member) => {
          const share = evenShares.find((s) => s.userId === member.user_id);
          const inputId = `bill-share-${member.user_id}`;
          return (
            <li key={member.user_id} className="flex min-h-14 items-center justify-between gap-3 py-2 text-sm">
              {mode === "even" ? (
                <>
                  <span className="truncate">{name(member)}</span>
                  <span className="shrink-0 text-zinc-600">{share ? `${fromUsdcUnits(share.units)} USDC` : "—"}</span>
                </>
              ) : (
                <>
                  <label htmlFor={inputId} className="truncate">{name(member)}</label>
                  <input id={inputId} value={amounts[member.user_id] ?? ""} disabled={saving}
                    onChange={(e) => { setAmounts((prev) => ({ ...prev, [member.user_id]: e.target.value })); setError(null); }}
                    inputMode="decimal" autoComplete="off" placeholder="0.00"
                    className="w-28 shrink-0 rounded-lg border border-zinc-300 px-3 py-2 text-right focus:outline-2 focus:outline-zinc-900 disabled:opacity-50" />
                </>
              )}
            </li>
          );
        })}
      </ul>

      {mode === "custom" && (
        <p role="status" className="text-sm text-zinc-600">
          {!allAmountsValid ? "Enter a valid amount for each person, or leave it blank."
            : left === null ? "Enter the total first."
            : left === BigInt(0) ? "All assigned."
            : left > BigInt(0) ? `Left to assign: ${fromUsdcUnits(left)} USDC`
            : `Over the total by ${fromUsdcUnits(-left)} USDC`}
        </p>
      )}

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={saving || !ready}
        className="w-full rounded-full bg-zinc-900 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50">
        {saving ? "Adding bill…" : "Add bill and send requests"}
      </button>
    </form>
  );
}
