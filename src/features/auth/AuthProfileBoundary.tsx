"use client";

import { createContext, useContext, type ReactNode } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { usePathname, useRouter } from "next/navigation";
import { Shell } from "@/components/Shell";
import { useSmartWalletAddress } from "./useSmartWalletAddress";
import { useSyncUser } from "./useSyncUser";
import { UsernameOnboarding } from "./UsernameOnboarding";

const ProfileSession = createContext<ReturnType<typeof useSyncUser> | null>(null);
export const useProfileSession = () => useContext(ProfileSession);

/** Gate all signed-in routes, including direct links, before mounting feature UI. */
export function AuthProfileBoundary({ children }: { children: ReactNode }) {
  const { ready, authenticated, user } = usePrivy();
  if (!ready) return <Shell><p role="status">Loading session…</p></Shell>;
  if (!authenticated || !user) return children;
  return <AuthenticatedBoundary key={user.id}>{children}</AuthenticatedBoundary>;
}

function AuthenticatedBoundary({ children }: { children: ReactNode }) {
  const address = useSmartWalletAddress();
  const session = useSyncUser(address);
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading, error, retry, setUser } = session;
  if (user?.username) return <ProfileSession.Provider value={session}>{children}</ProfileSession.Provider>;
  return <Shell>
    <div className="space-y-4">
      {loading && <p role="status">Preparing your profile…</p>}
      {error && <div role="alert" className="space-y-2 text-sm text-red-600">
        <p>{error}</p><button type="button" onClick={retry} disabled={loading} className="underline">Retry profile sync</button>
      </div>}
      {user && <UsernameOnboarding onSaved={(saved) => {
        setUser(saved);
        // A successful explicit submission is the only navigation trigger.
        if (pathname !== "/") router.replace("/");
      }} />}
    </div>
  </Shell>;
}
