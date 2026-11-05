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
export const BASE_SEPOLIA_USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;
export const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_ADDRESS || BASE_SEPOLIA_USDC_ADDRESS) as Address;
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

/** Keep all six decimals when needed; never round small balances to zero. */
export function formatUsdcBalance(units: bigint): string {
  const [whole, fraction = ""] = fromUsdcUnits(units).split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

/** The read calls the balance check needs; tests pass a fake instead of mocking viem. */
type UsdcReader = Pick<typeof publicClient, "getChainId" | "readContract">;

const verifiedConfiguration = new WeakMap<UsdcReader, Promise<void>>();
function verifyUsdcConfiguration(client: UsdcReader): Promise<void> {
  let check = verifiedConfiguration.get(client);
  if (!check) {
    check = (async () => {
      if (USDC_ADDRESS.toLowerCase() !== BASE_SEPOLIA_USDC_ADDRESS.toLowerCase()) throw new Error("Expected Circle USDC on Base Sepolia.");
      const [chainId, decimals] = await Promise.all([
        client.getChainId(),
        client.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "decimals" }),
      ]);
      if (chainId !== CHAIN_ID || decimals !== USDC_DECIMALS) throw new Error("Unexpected USDC network or decimals.");
    })().catch((error) => { verifiedConfiguration.delete(client); throw error; });
    verifiedConfiguration.set(client, check);
  }
  return check;
}

export async function getUsdcBalance(address: Address, client: UsdcReader = publicClient): Promise<bigint> {
  // Validate once per successful client session; retry validation after failures.
  await verifyUsdcConfiguration(client);
  return client.readContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  });
}
