"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { UserPicker } from "@/features/auth/UserPicker";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { isValidUsername, normalizeUsername, USERNAME_HELP } from "@/lib/username";
import { AddBillForm } from "./AddBillForm";
import { BillList } from "./BillList";
import { GroupsGate } from "./GroupsGate";
import { isUuid } from "./validation";

type Group = { id: string; name: string; created_by: string | null };
type Member = { user_id: string; username: string | null };
type Loaded = { group: Group | null; members: Member[] };
type Me = { id: string; username: string };

export function GroupDetails({ groupId }: { groupId: string }) {
  return <GroupsGate>{(me) => <GroupView groupId={groupId} me={me} />}</GroupsGate>;
}

function GroupView({ groupId, me }: { groupId: string; me: Me }) {
  const { getAccessToken } = usePrivy();
  const router = useRouter();
  const validId = isUuid(groupId);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [billsVersion, setBillsVersion] = useState(0);

  useEffect(() => {
    if (!validId) return;
    let cancelled = false;
    const db = getSupabaseBrowser();
    Promise.all([
      db.from("groups").select("id, name, created_by").eq("id", groupId).maybeSingle(),
      db.from("group_members").select("user_id, users(username)").eq("group_id", groupId),
    ]).then(([groupResult, membersResult]) => {
      if (cancelled) return;
      if (groupResult.error || membersResult.error) { setLoadError("Unable to load this group."); return; }
      const members = (membersResult.data ?? []).map((row) => ({
        user_id: row.user_id as string,
        username: (row.users as unknown as { username: string | null } | null)?.username ?? null,
      }));
      setLoaded({ group: groupResult.data, members });
    });
    return () => { cancelled = true; };
  }, [groupId, validId]);

  async function callApi(path: string, init: RequestInit) {
    const token = await getAccessToken();
    if (!token) throw new Error("Session expired. Please log in again.");
    const res = await fetch(path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Something went wrong. Please try again.");
    return body;
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const username = normalizeUsername(candidate);
    if (!isValidUsername(username)) { setNotice({ kind: "error", text: USERNAME_HELP }); return; }
    if (loaded?.members.some((m) => m.username === username)) {
      setNotice({ kind: "error", text: `@${username} is already in this group.` });
      return;
    }
    setBusy("add");
    setNotice(null);
    try {
      const { member } = await callApi(`/api/groups/${groupId}/members`, {
        method: "POST",
        body: JSON.stringify({ username }),
      });
      setLoaded((prev) => prev && { ...prev, members: [...prev.members, member] });
      setCandidate("");
      setNotice({ kind: "success", text: `Added @${username}.` });
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : "Unable to add member." });
    } finally { setBusy(null); }
  }

  async function removeMember(member: Member) {
    if (busy) return;
    const leaving = member.user_id === me.id;
    const question = leaving ? "Leave this group?" : `Remove @${member.username} from this group?`;
    if (!window.confirm(question)) return;
    setBusy(member.user_id);
    setNotice(null);
    try {
      await callApi(`/api/groups/${groupId}/members/${member.user_id}`, { method: "DELETE" });
      if (leaving) { router.push("/groups"); return; }
      setLoaded((prev) => prev && { ...prev, members: prev.members.filter((m) => m.user_id !== member.user_id) });
      setNotice({ kind: "success", text: `Removed @${member.username}.` });
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : "Unable to remove member." });
    } finally { setBusy(null); }
  }

  if (!validId || loaded?.group === null) {
    return (
      <div className="space-y-2 text-center">
        <p className="text-zinc-600">Group not found.</p>
        <Link href="/groups" className="text-sm underline">Back to my groups</Link>
      </div>
    );
  }
  if (loadError) return <p role="alert" className="text-sm text-red-600">{loadError}</p>;
  if (!loaded?.group) return <p role="status" className="text-sm text-zinc-600">Loading group…</p>;

  const { group, members } = loaded;
  const iAmMember = members.some((m) => m.user_id === me.id);
  const iAmCreator = group.created_by === me.id;

  return (
    <section className="space-y-4">
      <Link href="/groups" className="text-sm text-zinc-600 underline">← My groups</Link>
      <h1 className="text-xl font-semibold">{group.name}</h1>

      {notice && (
        <p role={notice.kind === "error" ? "alert" : "status"}
          className={`text-sm ${notice.kind === "error" ? "text-red-600" : "text-green-700"}`}>
          {notice.text}
        </p>
      )}

      {iAmMember && (
        <form onSubmit={addMember} className="space-y-2" aria-busy={busy === "add"}>
          <UserPicker label="Add a member" value={candidate} onChange={(value) => { setCandidate(value); setNotice(null); }} />
          <button type="submit" disabled={!!busy || !candidate}
            className="min-h-11 w-full rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50">
            {busy === "add" ? "Adding…" : "Add"}
          </button>
        </form>
      )}

      <div className="rounded-2xl border border-zinc-200 bg-white">
        <h2 className="border-b border-zinc-200 px-4 py-3 text-sm font-medium text-zinc-600">
          Members ({members.length})
        </h2>
        {members.length === 0 ? (
          <p className="px-4 py-3 text-sm text-zinc-600">No members yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-200">
            {members.map((member) => {
              const isCreator = member.user_id === group.created_by;
              const isMe = member.user_id === me.id;
              const canRemove = !isCreator && iAmMember && (isMe || iAmCreator);
              return (
                <li key={member.user_id} className="flex min-h-14 items-center justify-between gap-2 px-4 py-2">
                  <span className="truncate">
                    @{member.username ?? "unknown"}
                    {isMe && <span className="text-zinc-500"> (you)</span>}
                    {isCreator && <span className="ml-2 text-xs text-zinc-500">creator</span>}
                  </span>
                  {canRemove && (
                    <button type="button" onClick={() => void removeMember(member)} disabled={!!busy}
                      className="min-h-11 shrink-0 rounded-lg border border-zinc-300 px-3 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">
                      {busy === member.user_id ? "Removing…" : isMe ? "Leave" : "Remove"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {!iAmMember && <p className="text-sm text-zinc-600">You&apos;re not a member of this group.</p>}

      {iAmMember && members.length >= 2 && (
        <AddBillForm members={members} myId={me.id}
          submit={(body) => callApi(`/api/groups/${groupId}/splits`, { method: "POST", body: JSON.stringify(body) })}
          onAdded={() => {
            setBillsVersion((version) => version + 1);
            setNotice({ kind: "success", text: "Bill added. Requests sent." });
          }} />
      )}
      <BillList key={billsVersion} groupId={groupId} />
    </section>
  );
}
