"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

type GroupSummary = { id: string; name: string; created_at: string };

export function GroupList({ userId }: { userId: string }) {
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSupabaseBrowser().from("group_members").select("groups(id, name, created_at)").eq("user_id", userId)
      .then(({ data, error: loadError }) => {
        if (cancelled) return;
        if (loadError) { setError("Unable to load your groups."); return; }
        const list = (data ?? []).flatMap((row) => (row.groups ? [row.groups as unknown as GroupSummary] : []));
        setGroups(list.sort((a, b) => b.created_at.localeCompare(a.created_at)));
      });
    return () => { cancelled = true; };
  }, [userId]);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">My groups</h1>
        <Link href="/groups/new" className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700">
          New group
        </Link>
      </div>
      {error ? <p role="alert" className="text-sm text-red-600">{error}</p>
        : !groups ? <p role="status" className="text-sm text-zinc-600">Loading groups…</p>
        : groups.length === 0 ? <p className="text-sm text-zinc-600">You&apos;re not in any groups yet. Create one to get started.</p>
        : (
          <ul className="divide-y divide-zinc-200 rounded-2xl border border-zinc-200 bg-white">
            {groups.map((group) => (
              <li key={group.id}>
                <Link href={`/groups/${group.id}`} className="block px-4 py-3 font-medium hover:bg-zinc-50">{group.name}</Link>
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}
