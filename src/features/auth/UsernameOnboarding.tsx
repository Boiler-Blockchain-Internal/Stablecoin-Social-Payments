"use client";

import { useState, type FormEvent } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { isValidUsername, normalizeUsername, USERNAME_HELP } from "@/lib/username";
import type { AppUser } from "./useSyncUser";

export function UsernameOnboarding({ onSaved }: { onSaved: (user: AppUser) => void }) {
  const { getAccessToken } = usePrivy();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const username = normalizeUsername(value);
    if (!isValidUsername(username)) { setError(USERNAME_HELP); return; }
    setSaving(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Session expired. Please log in again.");
      const res = await fetch("/api/users/username", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Unable to save username.");
      onSaved(body.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save username. Please try again.");
    } finally { setSaving(false); }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6">
      <h1 className="text-xl font-semibold">Choose your username</h1>
      <p className="text-sm text-zinc-600">Your friends will use this name to find you on StablePay.</p>
      <form onSubmit={submit} className="space-y-4" aria-busy={saving}>
        <div className="space-y-2">
          <label htmlFor="username" className="block text-sm font-medium">Username</label>
          <input id="username" name="username" value={value} onChange={(e) => { setValue(e.target.value); setError(null); }}
            required minLength={3} maxLength={20} autoComplete="username" autoCapitalize="none" spellCheck={false}
            disabled={saving} aria-describedby="username-help username-error" aria-invalid={!!error}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 focus:outline-2 focus:outline-zinc-900 disabled:opacity-50" />
          <p id="username-help" className="text-sm text-zinc-500">{USERNAME_HELP} Names are saved in lowercase.</p>
          <p id="username-error" role="alert" className="text-sm text-red-600">{error}</p>
        </div>
        <button type="submit" disabled={saving} className="w-full rounded-full bg-zinc-900 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50">
          {saving ? "Saving username…" : "Save and continue"}
        </button>
      </form>
    </section>
  );
}
