import {
  createPublicClient, createWalletClient, custom, decodeEventLog, defineChain, encodeFunctionData,
  erc20Abi, http, isAddress, pad, parseUnits, zeroAddress, type Address, type Hash, type Hex, type Log,
} from "viem";
import { baseSepolia, sepolia } from "viem/chains";
import { BASE_SEPOLIA_USDC_ADDRESS, RPC_URL } from "@/lib/chain";

export const CCTP_TOKEN_MESSENGER = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA" as Address;
export const CCTP_MESSAGE_TRANSMITTER = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" as Address;
export const BASE_DOMAIN = 6;
export const STANDARD_FINALITY = 2000;
export const ZERO_BYTES32 = `0x${"0".repeat(64)}` as Hex;
const ARC_GAS_RESERVE = BigInt(50_000); // 0.05 USDC

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
  blockExplorers: { default: { name: "Arcscan", url: "https://testnet.arcscan.app" } },
  testnet: true,
});

export const DEPOSIT_CHAINS = {
  ethereum: {
    label: "Ethereum Sepolia",
    chain: sepolia,
    rpc: "https://ethereum-sepolia-rpc.publicnode.com",
    usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as Address,
    domain: 0,
  },
  arc: {
    label: "Arc Testnet",
    chain: arcTestnet,
    rpc: "https://rpc.testnet.arc.io",
    usdc: "0x3600000000000000000000000000000000000000" as Address,
    domain: 26,
  },
} as const;

export type DepositChain = keyof typeof DEPOSIT_CHAINS;

export const burnAbi = [{
  type: "function", name: "depositForBurn", stateMutability: "nonpayable",
  inputs: [
    { name: "amount", type: "uint256" },
    { name: "destinationDomain", type: "uint32" },
    { name: "mintRecipient", type: "bytes32" },
    { name: "burnToken", type: "address" },
    { name: "destinationCaller", type: "bytes32" },
    { name: "maxFee", type: "uint256" },
    { name: "minFinalityThreshold", type: "uint32" },
  ], outputs: [],
}, {
  type: "event", name: "DepositForBurn", inputs: [
    { name: "burnToken", type: "address", indexed: true },
    { name: "amount", type: "uint256" },
    { name: "depositor", type: "address", indexed: true },
    { name: "mintRecipient", type: "bytes32" },
    { name: "destinationDomain", type: "uint32" },
    { name: "destinationTokenMessenger", type: "bytes32" },
    { name: "destinationCaller", type: "bytes32" },
    { name: "maxFee", type: "uint256" },
    { name: "minFinalityThreshold", type: "uint32", indexed: true },
    { name: "hookData", type: "bytes" },
  ],
}] as const;

export const receiveAbi = [{
  type: "function", name: "receiveMessage", stateMutability: "nonpayable",
  inputs: [{ name: "message", type: "bytes" }, { name: "attestation", type: "bytes" }],
  outputs: [{ name: "success", type: "bool" }],
}, {
  // Non-zero once a message's nonce has been received, i.e. the destination mint happened.
  type: "function", name: "usedNonces", stateMutability: "view",
  inputs: [{ name: "nonce", type: "bytes32" }], outputs: [{ name: "", type: "uint256" }],
}] as const;

export function isDepositChain(value: unknown): value is DepositChain {
  return value === "ethereum" || value === "arc";
}

type ReceiptLog = Pick<Log, "address" | "data" | "topics">;

/** The CCTP burn in these logs that sends `source` USDC to `recipient` on Base Sepolia, if any. */
export function findDepositBurn(logs: readonly ReceiptLog[], source: DepositChain, recipient: Address): { amount: bigint; maxFee: bigint } | null {
  const usdc = DEPOSIT_CHAINS[source].usdc.toLowerCase();
  const mintRecipient = recipientBytes32(recipient).toLowerCase();
  // The smart wallet submits the mint, so only an open (zero) or wallet-only destination caller can complete.
  for (const log of logs) {
    if (log.address.toLowerCase() !== CCTP_TOKEN_MESSENGER.toLowerCase()) continue;
    try {
      const event = decodeEventLog({ abi: burnAbi, eventName: "DepositForBurn", data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (event.args.burnToken.toLowerCase() === usdc && event.args.destinationDomain === BASE_DOMAIN &&
        event.args.mintRecipient.toLowerCase() === mintRecipient && event.args.amount > BigInt(0) &&
        (event.args.destinationCaller === ZERO_BYTES32 || event.args.destinationCaller.toLowerCase() === mintRecipient)) {
        return { amount: event.args.amount, maxFee: event.args.maxFee };
      }
    } catch { /* Another TokenMessenger event. */ }
  }
  return null;
}

/** Base Sepolia USDC minted to `recipient` in these logs (CCTP mints are Transfers from the zero address). */
export function mintedTo(logs: readonly ReceiptLog[], recipient: Address): bigint {
  let total = BigInt(0);
  for (const log of logs) {
    // CCTP always mints canonical Circle USDC, whatever the app's USDC override says.
    if (log.address.toLowerCase() !== BASE_SEPOLIA_USDC_ADDRESS.toLowerCase()) continue;
    try {
      const event = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (event.args.from === zeroAddress && event.args.to.toLowerCase() === recipient.toLowerCase()) total += event.args.value;
    } catch { /* Not a Transfer. */ }
  }
  return total;
}

export type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
};

export function parseDepositAmount(amount: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(amount)) throw new Error("Enter a valid amount with up to 6 decimal places.");
  const units = parseUnits(amount, 6);
  if (units <= BigInt(0)) throw new Error("Amount must be greater than zero.");
  return units;
}

export function recipientBytes32(recipient: string): Hex {
  if (!isAddress(recipient)) throw new Error("Smart wallet address is invalid.");
  return pad(recipient as Address, { size: 32 });
}

export function sourceClient(source: DepositChain) {
  const config = DEPOSIT_CHAINS[source];
  return createPublicClient({ chain: config.chain, transport: http(config.rpc) });
}

export async function connectSource(provider: Eip1193Provider, source: DepositChain): Promise<Address> {
  const config = DEPOSIT_CHAINS[source];
  const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
  if (!accounts?.[0] || !isAddress(accounts[0])) throw new Error("Connect an EVM wallet to continue.");
  const current = await provider.request({ method: "eth_chainId" });
  if (current !== `0x${config.chain.id.toString(16)}`) {
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${config.chain.id.toString(16)}` }] });
    } catch (error) {
      // 4902 = unknown chain; MetaMask mobile nests it.
      const unknownChain = (error as { code?: number; data?: { originalError?: { code?: number } } });
      if (unknownChain.code !== 4902 && unknownChain.data?.originalError?.code !== 4902) throw error;
      await provider.request({ method: "wallet_addEthereumChain", params: [{
        chainId: `0x${config.chain.id.toString(16)}`,
        chainName: config.chain.name,
        nativeCurrency: config.chain.nativeCurrency,
        rpcUrls: [config.rpc],
        blockExplorerUrls: [config.chain.blockExplorers?.default.url].filter(Boolean),
      }] });
    }
  }
  if (await provider.request({ method: "eth_chainId" }) !== `0x${config.chain.id.toString(16)}`) {
    throw new Error(`Switch your wallet to ${config.label} before continuing.`);
  }
  return accounts[0] as Address;
}

export async function burnFromWallet(
  provider: Eip1193Provider, source: DepositChain, recipient: Address, amount: string,
  onProgress: (text: string) => void,
): Promise<Hash> {
  const config = DEPOSIT_CHAINS[source];
  const units = parseDepositAmount(amount);
  const sender = await connectSource(provider, source);
  const publicClient = sourceClient(source);
  const wallet = createWalletClient({ account: sender, chain: config.chain, transport: custom(provider as Parameters<typeof custom>[0]) });
  const [balance, allowance] = await Promise.all([
    publicClient.readContract({ address: config.usdc, abi: erc20Abi, functionName: "balanceOf", args: [sender] }),
    publicClient.readContract({ address: config.usdc, abi: erc20Abi, functionName: "allowance", args: [sender, CCTP_TOKEN_MESSENGER] }),
  ]);
  // Arc pays gas in the same USDC, so leave a little for the approve and burn fees.
  const reserve = source === "arc" ? ARC_GAS_RESERVE : BigInt(0);
  if (balance < units + reserve) {
    throw new Error(source === "arc"
      ? `Not enough USDC on Arc. Keep about 0.05 USDC beyond the deposit for network fees.`
      : `Not enough USDC on ${config.label}.`);
  }
  if (allowance < units) {
    onProgress("Approve USDC in your source wallet…");
    const approveHash = await wallet.sendTransaction({
      to: config.usdc,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [CCTP_TOKEN_MESSENGER, units] }),
      value: BigInt(0),
    });
    const approval = await publicClient.waitForTransactionReceipt({ hash: approveHash, timeout: 180_000 });
    if (approval.status !== "success") throw new Error("USDC approval did not succeed.");
  }
  onProgress("Confirm the USDC burn in your source wallet…");
  return wallet.sendTransaction({
    to: CCTP_TOKEN_MESSENGER,
    data: encodeFunctionData({
      abi: burnAbi,
      functionName: "depositForBurn",
      args: [units, BASE_DOMAIN, recipientBytes32(recipient), config.usdc, ZERO_BYTES32, BigInt(0), STANDARD_FINALITY],
    }),
    value: BigInt(0),
  });
}

export const baseClient = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });
