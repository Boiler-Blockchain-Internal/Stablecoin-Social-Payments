"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { UserPicker } from "@/features/auth/UserPicker";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { isValidUsername, normalizeUsername, USERNAME_HELP } from "@/lib/username";
import { GROUP_NAME_MAX } from "./validation";

export function CreateGroupForm({ myUsername }: { myUsername: string }) {
  const { getAccessToken } = usePrivy();
  const router = useRouter();
  const [name, setName] = useState("");
  const [candidate, setCandidate] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  async function addMember() {
    const username = normalizeUsername(candidate);
    if (!isValidUsername(username)) { setMemberError(USERNAME_HELP); return; }
    if (username === myUsername) { setMemberError("You're added to your own group automatically."); return; }
    if (members.includes(username)) { setMemberError(`@${username} is already in the list.`); return; }
    setChecking(true);
    setMemberError(null);
    const { data, error: lookupError } = await getSupabaseBrowser()
      .from("users").select("id").eq("username", username).maybeSingle();
    setChecking(false);
    if (lookupError) { setMemberError("Couldn't check that username. Please try again."); return; }
    if (!data) { setMemberError(`No user found for @${username}.`); return; }
    setMembers((list) => [...list, username]);
    setCandidate("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const trimmed = name.trim();
    if (!trimmed) { setError("Give your group a name."); return; }
    setSaving(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Session expired. Please log in again.");
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, members }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Unable to create group.");
      setCreated(true);
      router.push(`/groups/${body.group.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to create group. Please try again.");
      setSaving(false);
    }
  }

  if (created) return <p role="status" className="text-sm text-green-700">Group created! Opening it…</p>;

  return (
    <section className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6">
      <h1 className="text-xl font-semibold">New group</h1>
      <form onSubmit={submit} className="space-y-5" aria-busy={saving}>
        <div className="space-y-2">
          <label htmlFor="group-name" className="block text-sm font-medium">Group name</label>
          <input id="group-name" value={name} onChange={(e) => { setName(e.target.value); setError(null); }}
            required maxLength={GROUP_NAME_MAX} disabled={saving} placeholder="Roommates"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 focus:outline-2 focus:outline-zinc-900 disabled:opacity-50" />
        </div>

        <div className="space-y-2">
          <span className="block text-sm font-medium">Members</span>
          <div className="flex gap-2"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addMember(); } }}>
            <div className="flex-1">
              <UserPicker value={candidate} onChange={(value) => { setCandidate(value); setMemberError(null); }} />
            </div>
            <button type="button" onClick={() => void addMember()} disabled={saving || checking || !candidate}
              className="min-h-11 rounded-lg border border-zinc-300 px-4 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50">
              {checking ? "Checking…" : "Add"}
            </button>
          </div>
          <p role="alert" className="text-sm text-red-600">{memberError}</p>
          <ul className="flex flex-wrap gap-2">
            <li className="rounded-full bg-zinc-100 px-3 py-1 text-sm text-zinc-600">@{myUsername} (you)</li>
            {members.map((username) => (
              <li key={username} className="flex items-center gap-1 rounded-full bg-zinc-100 py-1 pl-3 pr-1 text-sm">
                @{username}
                <button type="button" onClick={() => setMembers((list) => list.filter((m) => m !== username))}
                  disabled={saving} aria-label={`Remove @${username}`}
                  className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-zinc-200 disabled:opacity-50">
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>

        <p role="alert" className="text-sm text-red-600">{error}</p>
        <button type="submit" disabled={saving}
          className="w-full rounded-full bg-zinc-900 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50">
          {saving ? "Creating group…" : "Create group"}
        </button>
      </form>
    </section>
  );
}
