"use client";

import Link from "next/link";
import { Shell } from "@/components/Shell";
import { useCurrentUser } from "@/features/groups/useCurrentUser";
import { RequestsInbox } from "@/features/requests/RequestsInbox";

export default function RequestsPage() {
  const { ready, authenticated, user, error } = useCurrentUser();
  return (
    <Shell>
      {!ready ? <p role="status" className="text-sm text-zinc-600">Loading…</p>
        : !authenticated ? <p className="text-center text-zinc-600">Log in with email or Google to see your requests.</p>
        : error ? <p role="alert" className="text-sm text-red-600">{error}</p>
        : !user?.username ? (
          <p className="text-center text-zinc-600">
            Finish setting up your profile on the <Link href="/" className="underline">home page</Link> first.
          </p>
        )
        : <RequestsInbox key={user.id} userId={user.id} />}
    </Shell>
  );
}
