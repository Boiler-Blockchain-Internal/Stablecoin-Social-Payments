import {
  createPublicClient,
  erc20Abi,
  formatUnits,
  http,
  parseUnits,
  type Address,
} from "viem";
import { baseSepolia } from "viem/chains";

// Base Sepolia testnet (chain id 84532). Every on-chain call in the app targets this chain.
export const chain = baseSepolia;
export const CHAIN_ID = baseSepolia.id;

export const RPC_URL =
  process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

// Circle's USDC on Base Sepolia. 6 decimals, so "1.50" USDC === 1_500_000 base units.
export const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_ADDRESS ||
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as Address;
export const USDC_DECIMALS = 6;

export { erc20Abi };

// Read-only client for balances, receipts, etc. Writes go through the Privy smart wallet client.
export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

export function toUsdcUnits(amount: string): bigint {
  return parseUnits(amount, USDC_DECIMALS);
}

export function fromUsdcUnits(units: bigint): string {
  return formatUnits(units, USDC_DECIMALS);
}

export async function getUsdcBalance(address: Address): Promise<bigint> {
  return publicClient.readContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  });
}
