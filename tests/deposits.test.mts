import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import { encodeAbiParameters, encodeEventTopics, pad, type Address, type Hash, type Hex } from "viem";

type Row = Record<string, unknown>;
class UnauthorizedError extends Error {}
const WALLET = "0x1111111111111111111111111111111111111111" as Address;
const OTHER_WALLET = "0x2222222222222222222222222222222222222222" as Address;
const A = "10000000-0000-4000-8000-00000000000a";
const B = "10000000-0000-4000-8000-00000000000b";
const BURN = `0x${"ab".repeat(32)}` as Hash;
const MINT = `0x${"cd".repeat(32)}` as Hash;
const NONCE = `0x${"01".repeat(32)}`;
let tables: Record<string, Row[]> = {};
let nextId = 0;

mock.module("../src/lib/privy.ts", { namedExports: {
  UnauthorizedError,
  getSmartWalletAddress: async (privyId: string) => (privyId === "account-a" ? WALLET : privyId === "account-b" ? OTHER_WALLET : null),
} });

mock.module("../src/lib/supabase-server.ts", { namedExports: {
  getSupabaseAdmin: () => ({ from: (table: string) => {
    let operation = "select";
    let payload: Row = {};
    const filters: ((row: Row) => boolean)[] = [];
    function execute(): { data: Row[] | null; error: { message: string; code?: string } | null } {
      if (operation === "insert") {
        if (table === "deposits" && tables.deposits.some((row) => row.burn_tx_hash === payload.burn_tx_hash)) {
          return { data: null, error: { message: "duplicate", code: "23505" } };
        }
        const row = { id: `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`, created_at: "2026-11-12T00:00:00.000Z", mint_tx_hash: null, ...payload };
        tables[table].push(row);
        return { data: [row], error: null };
      }
      const matching = tables[table].filter((row) => filters.every((filter) => filter(row)));
      if (operation === "update") matching.forEach((row) => Object.assign(row, payload));
      return { data: matching.map((row) => ({ ...row })), error: null };
    }
    const query = {
      select: () => query,
      order: () => query,
      limit: () => query,
      insert: (input: Row) => { operation = "insert"; payload = input; return query; },
      update: (input: Row) => { operation = "update"; payload = input; return query; },
      eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
      single: async () => {
        const result = execute();
        return result.error ? result : { data: result.data?.[0] ?? null, error: result.data?.length ? null : { message: "no rows" } };
      },
      maybeSingle: async () => {
        const result = execute();
        return result.error ? result : { data: result.data?.[0] ?? null, error: null };
      },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(execute()).then(resolve, reject),
    };
    return query;
  } }),
} });

const { progressDeposit } = await import("../src/features/deposits/server");
const { burnAbi, findDepositBurn, mintedTo, CCTP_TOKEN_MESSENGER, DEPOSIT_CHAINS } = await import("../src/features/deposits/cctp");
const { USDC_ADDRESS } = await import("../src/lib/chain");

function burnLog({ recipient = WALLET, domain = 6, token = DEPOSIT_CHAINS.arc.usdc as Address, amount = BigInt(2_500_000), maxFee = BigInt(0) } = {}) {
  return {
    address: CCTP_TOKEN_MESSENGER,
    topics: encodeEventTopics({ abi: burnAbi, eventName: "DepositForBurn", args: { burnToken: token, depositor: OTHER_WALLET, minFinalityThreshold: 2000 } }) as [Hex, ...Hex[]],
    data: encodeAbiParameters(
      [{ type: "uint256" }, { type: "bytes32" }, { type: "uint32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "bytes" }],
      [amount, pad(recipient, { size: 32 }), domain, pad(CCTP_TOKEN_MESSENGER, { size: 32 }), `0x${"0".repeat(64)}`, maxFee, "0x"],
    ),
  };
}
const transferAbi = [{ type: "event", name: "Transfer", inputs: [
  { name: "from", type: "address", indexed: true }, { name: "to", type: "address", indexed: true }, { name: "value", type: "uint256", indexed: false },
] }] as const;
function mintLog(to: Address, value: bigint) {
  return {
    address: USDC_ADDRESS,
    topics: encodeEventTopics({ abi: transferAbi, eventName: "Transfer", args: { from: "0x0000000000000000000000000000000000000000", to } }) as [Hex, ...Hex[]],
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
  };
}

/** A fake chain + Circle: tweak these per test. */
let burnReceipt: { status: string; logs: ReturnType<typeof burnLog>[] } | null;
let iris: { status: number; body?: unknown };
let usedNonce: bigint;
let mintReceipt: { status: string; logs: ReturnType<typeof mintLog>[] } | null;
let irisCalls = 0;
const net = {
  source: () => ({ getTransactionReceipt: async () => { if (!burnReceipt) throw new Error("not found"); return burnReceipt; } }),
  base: {
    readContract: async () => usedNonce,
    getTransactionReceipt: async () => { if (!mintReceipt) throw new Error("not found"); return mintReceipt; },
  },
  fetch: async () => { irisCalls++; return new Response(JSON.stringify(iris.body ?? {}), { status: iris.status }); },
} as unknown as Parameters<typeof progressDeposit>[2];
const completeMessage = { status: "complete", message: "0x1234", attestation: "0x5678", eventNonce: NONCE };

beforeEach(() => {
  nextId = 0;
  irisCalls = 0;
  tables = {
    users: [{ id: A, privy_id: "account-a" }, { id: B, privy_id: "account-b" }],
    deposits: [],
  };
  burnReceipt = { status: "success", logs: [burnLog()] };
  iris = { status: 404, body: { error: "Message not found for provided parameters" } };
  usedNonce = BigInt(0);
  mintReceipt = null;
});

test("findDepositBurn matches only a burn of the source's USDC to this wallet on Base", () => {
  assert.deepEqual(findDepositBurn([burnLog()], "arc", WALLET), { amount: BigInt(2_500_000), maxFee: BigInt(0) });
  assert.equal(findDepositBurn([burnLog({ recipient: OTHER_WALLET })], "arc", WALLET), null);
  assert.equal(findDepositBurn([burnLog({ domain: 3 })], "arc", WALLET), null);
  assert.equal(findDepositBurn([burnLog()], "ethereum", WALLET), null);
  assert.equal(findDepositBurn([{ ...burnLog(), address: OTHER_WALLET }], "arc", WALLET), null);
});

test("mintedTo sums Base USDC minted to the wallet", () => {
  assert.equal(mintedTo([mintLog(WALLET, BigInt(5)), mintLog(OTHER_WALLET, BigInt(9)), mintLog(WALLET, BigInt(2))], WALLET), BigInt(7));
});

test("an unmined burn is reported as burning and not recorded", async () => {
  burnReceipt = null;
  assert.deepEqual(await progressDeposit("account-a", { source: "arc", burnHash: BURN }, net), { status: "burning" });
  assert.equal(tables.deposits.length, 0);
});

test("a verified burn is recorded from chain data, and Circle's 404 means still attesting", async () => {
  const result = await progressDeposit("account-a", { source: "arc", burnHash: BURN.toUpperCase().replace("0X", "0x"), amount: "999" }, net);
  assert.equal(result.status, "attesting");
  assert.equal(tables.deposits.length, 1);
  assert.deepEqual(
    { user: tables.deposits[0].user_id, amount: tables.deposits[0].amount, status: tables.deposits[0].status, hash: tables.deposits[0].burn_tx_hash },
    { user: A, amount: "2.5", status: "pending", hash: BURN },
  );
  await progressDeposit("account-a", { source: "arc", burnHash: BURN }, net);
  assert.equal(tables.deposits.length, 1);
});

test("burns that aren't a deposit to the caller's wallet are refused", async () => {
  burnReceipt = { status: "success", logs: [burnLog({ recipient: OTHER_WALLET })] };
  await assert.rejects(progressDeposit("account-a", { source: "arc", burnHash: BURN }, net), /isn't a CCTP deposit/);
  burnReceipt = { status: "reverted", logs: [] };
  await assert.rejects(progressDeposit("account-a", { source: "arc", burnHash: BURN }, net), /failed on the source network/);
  assert.equal(tables.deposits.length, 0);
});

test("another account can't claim or advance someone's deposit", async () => {
  await progressDeposit("account-a", { source: "arc", burnHash: BURN }, net);
  await assert.rejects(progressDeposit("account-b", { source: "arc", burnHash: BURN }, net), /another account/);
});

test("a ready attestation is handed to the browser to mint", async () => {
  iris = { status: 200, body: { messages: [{ status: "pending_confirmations" }, completeMessage] } };
  const result = await progressDeposit("account-a", { source: "arc", burnHash: BURN }, net);
  assert.equal(result.status, "ready");
  assert.ok(result.status === "ready" && result.message === "0x1234" && result.attestation === "0x5678");
});

test("once Base has used the nonce the deposit completes, keeping a verified mint hash", async () => {
  iris = { status: 200, body: { messages: [completeMessage] } };
  usedNonce = BigInt(1);
  mintReceipt = { status: "success", logs: [mintLog(WALLET, BigInt(2_500_000))] };
  const result = await progressDeposit("account-a", { source: "arc", burnHash: BURN, mintHash: MINT }, net);
  assert.equal(result.status, "completed");
  assert.equal(tables.deposits[0].status, "completed");
  assert.equal(tables.deposits[0].mint_tx_hash, MINT);
  const calls = irisCalls;
  assert.equal((await progressDeposit("account-a", { source: "arc", burnHash: BURN }, net)).status, "completed");
  assert.equal(irisCalls, calls, "a completed deposit needs no more Circle calls");
});

test("a mint hash that didn't mint to this wallet isn't stored", async () => {
  iris = { status: 200, body: { messages: [completeMessage] } };
  usedNonce = BigInt(1);
  mintReceipt = { status: "success", logs: [mintLog(OTHER_WALLET, BigInt(2_500_000))] };
  await progressDeposit("account-a", { source: "arc", burnHash: BURN, mintHash: MINT }, net);
  assert.equal(tables.deposits[0].status, "completed");
  assert.equal(tables.deposits[0].mint_tx_hash, null);
});

test("Circle outages and bad input are reported, not swallowed", async () => {
  iris = { status: 503 };
  await assert.rejects(progressDeposit("account-a", { source: "arc", burnHash: BURN }, net), /unavailable/);
  await assert.rejects(progressDeposit("account-a", { source: "solana", burnHash: BURN }, net), /Choose Ethereum Sepolia or Arc/);
  await assert.rejects(progressDeposit("account-a", { source: "arc", burnHash: "0x12" }, net), /valid burn transaction hash/);
  await assert.rejects(progressDeposit("account-new", { source: "arc", burnHash: BURN }, net), /Finish setting up/);
});
