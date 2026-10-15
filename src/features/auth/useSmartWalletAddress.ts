"use client";

import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import type { Address } from "viem";

/** The logged-in user's smart wallet address: THE user's address everywhere in this app. */
export function useSmartWalletAddress(): Address | undefined {
  const { client } = useSmartWallets();
  return client?.account.address;
}
