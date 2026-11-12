"use client";

import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { usePrivy } from "@privy-io/react-auth";
import type { Address } from "viem";
import { linkedSmartWalletAddress } from "./linkedSmartWallet";

/** The logged-in user's smart wallet address: THE user's address everywhere in this app. */
export function useSmartWalletAddress(): Address | undefined {
  const { client } = useSmartWallets();
  const { ready, authenticated, user } = usePrivy();
  const address = client?.account.address;
  // During account switching, never reuse a previous user's SDK client address.
  if (!ready || !authenticated || !user || !address) return undefined;
  return linkedSmartWalletAddress(user, address);
}
