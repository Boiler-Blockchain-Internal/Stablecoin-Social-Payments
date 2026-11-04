"use client";

import Link from "next/link";
import { Shell } from "@/components/Shell";
import { useCurrentUser } from "@/features/groups/useCurrentUser";
import { HistoryFeed } from "@/features/history/HistoryFeed";

export default function ActivityPage() {
  const { ready, authenticated, user, error } = useCurrentUser();
  return (
    <Shell>
      {!ready ? <p role="status">Loading…</p>
        : !authenticated ? <p>Log in with email or Google to view your activity.</p>
        : error ? <p role="alert" className="text-red-700">{error}</p>
        : !user?.username ? <p>Finish setting up your profile on the <Link href="/" className="underline">home page</Link> first.</p>
        : <HistoryFeed key={user.id} userId={user.id} />}
    </Shell>
  );
}
