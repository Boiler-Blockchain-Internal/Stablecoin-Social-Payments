"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useSmartWalletAddress } from "./useSmartWalletAddress";
import { useSyncUser } from "./useSyncUser";
import { UsernameOnboarding } from "./UsernameOnboarding";
import { WalletCard } from "./WalletCard";

export function ProfileGate() {
  const { ready, authenticated, user } = usePrivy();
  if (!ready) return <p role="status">Loading session…</p>;
  if (!authenticated || !user) return <p className="text-center text-zinc-600">Log in with email or Google to see your wallet.</p>;
  return <AuthenticatedProfile key={user.id} />;
}

function AuthenticatedProfile() {
  const address = useSmartWalletAddress();
  const { user, loading, error, retry, setUser } = useSyncUser(address);
  return (
    <div className="space-y-4">
      {error && <div role="alert" className="space-y-2 text-sm text-red-600"><p>{error}</p><button type="button" onClick={retry} className="underline">Retry profile sync</button></div>}
      {!user ? (loading ? <p role="status">Saving your profile…</p> : null) :
        !user.username ? <UsernameOnboarding onSaved={setUser} /> : <>
          <p role="status" className="text-sm text-zinc-600">Welcome, @{user.username}</p>
          <WalletCard />
        </>}
    </div>
  );
}
