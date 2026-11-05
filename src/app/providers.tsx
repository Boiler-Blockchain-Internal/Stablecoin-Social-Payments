"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { SmartWalletsProvider } from "@privy-io/react-auth/smart-wallets";
import { chain } from "@/lib/chain";
import { AuthProfileBoundary } from "@/features/auth/AuthProfileBoundary";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        loginMethods: ["email", "google"],
        // The embedded wallet is only the *signer*. The user's address everywhere in
        // this app is their smart wallet (gas is sponsored by the paymaster set in Privy's dashboard).
        embeddedWallets: { ethereum: { createOnLogin: "all-users" } },
        defaultChain: chain,
        supportedChains: [chain],
      }}
    >
      <SmartWalletsProvider><AuthProfileBoundary>{children}</AuthProfileBoundary></SmartWalletsProvider>
    </PrivyProvider>
  );
}
