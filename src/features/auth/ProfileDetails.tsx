"use client";

import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useSyncUser } from "./useSyncUser";
import { UsernameOnboarding } from "./UsernameOnboarding";

/** Uses the existing verified sync endpoint; no browser-supplied profile ID. */
export function ProfileDetails() {
  const { ready, authenticated, user } = usePrivy();
  return (
    <section className="space-y-5">
      <Link href="/" className="text-sm text-zinc-600 underline">Back to home</Link>
      <h1 className="text-2xl font-semibold">Your profile</h1>
      {!ready ? <p role="status">Loading session…</p> :
        !authenticated || !user ? <p className="text-zinc-600">Log in using the button above to view your profile.</p> :
          <CurrentProfile key={user.id} />}
    </section>
  );
}

function CurrentProfile() {
  // This fetches the verified user's Supabase row and creates it if Week 1 sync
  // has not run yet. Wallet creation is not required to open a profile.
  const { user, loading, error, retry, setUser } = useSyncUser(undefined);
  const joined = user ? new Date(user.created_at) : null;
  return (
    <div className="space-y-4">
      {loading && <p role="status" className="text-sm text-zinc-500">Loading profile…</p>}
      {error && <div role="alert" className="space-y-2 text-sm text-red-600">
        <p>{error}</p>
        <button type="button" onClick={retry} className="underline">Retry profile</button>
      </div>}
      {user && (!user.username ? <>
        <p className="text-sm text-zinc-600">Finish choosing your username to complete your profile.</p>
        <UsernameOnboarding onSaved={setUser} />
      </> : <div className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-6">
        <dl className="space-y-4">
          <div>
            <dt className="text-sm font-medium text-zinc-500">Username</dt>
            <dd className="break-all text-lg font-semibold" data-testid="profile-username">@{user.username}</dd>
          </div>
          {joined && !Number.isNaN(joined.getTime()) && <div>
            <dt className="text-sm font-medium text-zinc-500">Member since</dt>
            <dd><time dateTime={user.created_at}>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(joined)}</time></dd>
          </div>}
        </dl>
        <button type="button" onClick={retry} disabled={loading} className="text-sm text-zinc-600 underline disabled:opacity-50">Refresh profile</button>
      </div>)}
    </div>
  );
}
