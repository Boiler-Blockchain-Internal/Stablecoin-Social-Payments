"use client";

import Link from "next/link";
import { useCurrentUser, type GroupsUser } from "./useCurrentUser";

type Me = GroupsUser & { username: string };

/** Renders children only for a logged-in user who has picked a username. */
export function GroupsGate({ children }: { children: (me: Me) => React.ReactNode }) {
  const { ready, authenticated, user, error } = useCurrentUser();
  if (!ready) return <p role="status" className="text-sm text-zinc-600">Loading…</p>;
  if (!authenticated) return <p className="text-center text-zinc-600">Log in with email or Google to use groups.</p>;
  if (error) return <p role="alert" className="text-sm text-red-600">{error}</p>;
  if (!user?.username) {
    return (
      <p className="text-center text-zinc-600">
        Finish setting up your profile on the <Link href="/" className="underline">home page</Link> first.
      </p>
    );
  }
  return <>{children({ ...user, username: user.username })}</>;
}
