"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { GroupsGate } from "./GroupsGate";
import { isUuid } from "./validation";

type Group = { id: string; name: string; created_by: string | null };
type Member = { user_id: string; username: string | null };
type Loaded = { group: Group | null; members: Member[] };

export function GroupDetails({ groupId }: { groupId: string }) {
  return <GroupsGate>{() => <GroupView groupId={groupId} />}</GroupsGate>;
}

function GroupView({ groupId }: { groupId: string }) {
  const validId = isUuid(groupId);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!validId) return;
    let cancelled = false;
    const db = getSupabaseBrowser();
    Promise.all([
      db.from("groups").select("id, name, created_by").eq("id", groupId).maybeSingle(),
      db.from("group_members").select("user_id, users(username)").eq("group_id", groupId),
    ]).then(([groupResult, membersResult]) => {
      if (cancelled) return;
      if (groupResult.error || membersResult.error) { setError("Unable to load this group."); return; }
      const members = (membersResult.data ?? []).map((row) => ({
        user_id: row.user_id as string,
        username: (row.users as unknown as { username: string | null } | null)?.username ?? null,
      }));
      setLoaded({ group: groupResult.data, members });
    });
    return () => { cancelled = true; };
  }, [groupId, validId]);

  if (!validId || loaded?.group === null) {
    return (
      <div className="space-y-2 text-center">
        <p className="text-zinc-600">Group not found.</p>
        <Link href="/groups" className="text-sm underline">Back to my groups</Link>
      </div>
    );
  }
  if (error) return <p role="alert" className="text-sm text-red-600">{error}</p>;
  if (!loaded?.group) return <p role="status" className="text-sm text-zinc-600">Loading group…</p>;

  const { group, members } = loaded;
  return (
    <section className="space-y-4">
      <Link href="/groups" className="text-sm text-zinc-600 underline">← My groups</Link>
      <h1 className="text-xl font-semibold">{group.name}</h1>
      <div className="rounded-2xl border border-zinc-200 bg-white">
        <h2 className="border-b border-zinc-200 px-4 py-3 text-sm font-medium text-zinc-600">
          Members ({members.length})
        </h2>
        <ul className="divide-y divide-zinc-200">
          {members.map((member) => (
            <li key={member.user_id} className="flex items-center justify-between px-4 py-3">
              <span>@{member.username ?? "unknown"}</span>
              {member.user_id === group.created_by && <span className="text-xs text-zinc-500">creator</span>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
