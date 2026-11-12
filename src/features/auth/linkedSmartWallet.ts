import type { Address } from "viem";

type WalletOwner = { linkedAccounts: readonly { type: string; address?: string }[] };

/** Shared by SDK selection and direct hook callers; never fall back to an EOA. */
export function linkedSmartWalletAddress(owner: WalletOwner | null | undefined, address: Address | undefined): Address | undefined {
  if (!address || !owner) return undefined;
  return owner.linkedAccounts?.some((account) => account.type === "smart_wallet" && account.address?.toLowerCase() === address.toLowerCase())
    ? address : undefined;
}
