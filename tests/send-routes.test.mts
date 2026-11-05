import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, parseUnits, type Address, type Hash } from "viem";
import { entryPoint07Abi, entryPoint07Address } from "viem/account-abstraction";
import { parseAmount } from "../src/features/requests/validation";

type Row = Record<string, unknown>;
const SENDER = "0x1111111111111111111111111111111111111111" as Address;
const RECIPIENT = "0x2222222222222222222222222222222222222222" as Address;
const TOKEN = "0x036cbd53842c5426634e7929541ec2318f3dcf7e" as Address;
const A = "10000000-0000-4000-8000-00000000000a";
const B = "10000000-0000-4000-8000-00000000000b";
const HASH = `0x${"ab".repeat(32)}` as Hash;
const OTHER_HASH = `0x${"cd".repeat(32)}` as Hash;
const REFERENCE = "30000000-0000-4000-8000-000000000001";
const SECOND_REFERENCE = "30000000-0000-4000-8000-000000000002";
const REQUEST_ID = "40000000-0000-4000-8000-000000000001";
const transferAbi = [
  { type: "event", name: "Transfer", anonymous: false, inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false },
  ] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [
    { name: "to", type: "address" }, { name: "value", type: "uint256" },
  ], outputs: [{ name: "", type: "bool" }] },
] as const;

class UnauthorizedError extends Error {}
let tables: Record<string, Row[]> = {};
let receipts = new Map<string, Row>();
let transactions = new Map<string, Row>();
let failUpdateInto: string | null = null;
let nextId = 0;
let mockedChainId = 84532;
let chainLogs: { args: { value: bigint }; transactionHash: Hash }[] = [];

mock.module("../src/lib/privy.ts", { namedExports: {
  UnauthorizedError,
  requirePrivyUser: async (request: Request) => {
    const token = request.headers.get("authorization");
    if (!token?.startsWith("Bearer account-")) throw new UnauthorizedError("Invalid token");
    return token.slice(7);
  },
  getSmartWalletAddress: async (privyId: string) => privyId === "account-a" ? SENDER : privyId === "account-b" ? RECIPIENT : null,
} });

mock.module("../src/lib/supabase-server.ts", { namedExports: {
  getSupabaseAdmin: () => ({ from: (table: string) => {
    let operation = "select";
    let payload: Row = {};
    const filters: ((row: Row) => boolean)[] = [];
    const orFilters: ((row: Row) => boolean)[] = [];
    function execute() {
      if (operation === "insert") {
        if (table === "transactions" && tables.transactions.some((row) => row.client_reference === payload.client_reference || (payload.tx_hash && row.tx_hash === payload.tx_hash) ||
          (payload.client_reference != null && row.client_reference != null && row.from_user === payload.from_user && row.status === "pending"))) {
          return { data: null, error: { message: "duplicate key", code: "23505" } };
        }
        const row = { id: `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`, created_at: "2026-11-04T00:00:00.000Z", ...payload };
        tables[table].push(row);
        return { data: [row], error: null };
      }
      const matching = tables[table].filter((row) => filters.every((filter) => filter(row)) && (!orFilters.length || orFilters.some((filter) => filter(row))));
      if (operation === "update" && failUpdateInto === table) return { data: null, error: { message: "private database detail" } };
      if (operation === "update") matching.forEach((row) => Object.assign(row, payload));
      return { data: matching.map((row) => ({ ...row })), error: null };
    }
    const query = {
      select: () => query,
      insert: (input: Row) => { operation = "insert"; payload = input; return query; },
      update: (input: Row) => { operation = "update"; payload = input; return query; },
      eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
      not: (key: string, operator: string, value: unknown) => {
        if (operator === "is" && value === null) filters.push((row) => row[key] != null);
        return query;
      },
      is: (key: string, value: unknown) => { filters.push((row) => (row[key] ?? null) === value); return query; },
      in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return query; },
      or: (expression: string) => {
        const match = expression.match(/^tx_hash\.is\.null,tx_hash\.eq\.(.+)$/);
        if (match) orFilters.push((row) => row.tx_hash == null || row.tx_hash === match[1]);
        return query;
      },
      single: async () => {
        const result = execute();
        return result.error ? result : result.data?.length ? { data: result.data[0], error: null } : { data: null, error: { message: "no rows" } };
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

mock.module("../src/lib/chain.ts", { namedExports: {
  CHAIN_ID: 84532,
  chain: { id: 84532 },
  USDC_ADDRESS: TOKEN,
  erc20Abi: transferAbi,
  toUsdcUnits: (amount: string) => parseUnits(amount, 6),
  publicClient: {
    getChainId: async () => mockedChainId,
    getTransactionReceipt: async ({ hash }: { hash: Hash }) => {
      const receipt = receipts.get(hash);
      if (!receipt) throw new Error("transaction not found");
      return receipt;
    },
    getBlockNumber: async () => BigInt(1_000_000),
    getLogs: async () => chainLogs,
    getBlock: async () => ({ timestamp: BigInt(Math.floor(Date.parse("2026-11-04T00:00:01.000Z") / 1000)) }),
    getTransaction: async ({ hash }: { hash: Hash }) => {
      const transaction = transactions.get(hash);
      if (!transaction) throw new Error("transaction not found");
      return transaction;
    },
  },
} });

const { GET: getOpenPayment, POST: prepare } = await import("../src/app/api/transactions/route");
const { GET: getPayment, POST: record } = await import("../src/app/api/transactions/[id]/route");

function request(body: unknown, account = "account-a") {
  return new Request("http://localhost/api/transactions", {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${account}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
function byId(handler: typeof getPayment | typeof record, id: string, body?: unknown, account = "account-a") {
  return handler(request(body, account), { params: Promise.resolve({ id }) });
}
function prepareBody(overrides: Row = {}) {
  return { action: "prepare", toUsername: "bob", amount: "1.25", note: "lunch", clientReference: REFERENCE, ...overrides };
}
async function preparedPayment() {
  const response = await prepare(request(prepareBody()));
  assert.equal(response.status, 201);
  return (await response.json()) as { payment: { id: string } };
}
function successReceipt(from = SENDER, to = RECIPIENT, value = BigInt(1_250_000), token = TOKEN) {
  const topics = encodeEventTopics({ abi: transferAbi, eventName: "Transfer", args: { from, to } });
  return {
    status: "success",
    blockHash: `0x${"11".repeat(32)}`,
    logs: [{
      address: token,
      topics,
      data: encodeAbiParameters([{ type: "uint256" }], [value]),
    }],
  };
}
function failedUserOperationReceipt(sender = SENDER, succeeded = false) {
  const topics = encodeEventTopics({ abi: entryPoint07Abi, eventName: "UserOperationEvent", args: {
    userOpHash: HASH,
    sender,
    paymaster: "0x3333333333333333333333333333333333333333" as Address,
  } });
  return {
    status: "success",
    blockHash: `0x${"22".repeat(32)}`,
    logs: [{
      address: entryPoint07Address,
      topics,
      data: encodeAbiParameters([
        { type: "uint256" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" },
      ], [BigInt(0), succeeded, BigInt(1), BigInt(1)]),
    }],
  };
}
function directTransfer(to = RECIPIENT, value = BigInt(1_250_000)) {
  return {
    from: SENDER,
    to: TOKEN,
    input: encodeFunctionData({ abi: transferAbi, functionName: "transfer", args: [to, value] }),
  };
}

beforeEach(() => {
  failUpdateInto = null;
  nextId = 0;
  mockedChainId = 84532;
  chainLogs = [];
  receipts = new Map();
  transactions = new Map();
  tables = {
    users: [
      { id: A, privy_id: "account-a", username: "alice", wallet_address: SENDER },
      { id: B, privy_id: "account-b", username: "bob", wallet_address: RECIPIENT },
    ],
    requests: [],
    transactions: [],
  };
});

test("amount validation accepts USDC precision and rejects malformed amounts", () => {
  assert.equal(parseAmount("0.000001"), "0.000001");
  for (const value of ["0", "-1", "1e2", "1.0000001", "10000.01", "Infinity", ""]) assert.equal(parseAmount(value), null, value);
});

test("prepares a pending intent from authenticated user rows and is idempotent", async () => {
  const first = await prepare(request(prepareBody({ toUsername: " Bob " })));
  assert.equal(first.status, 201);
  const body = await first.json();
  assert.equal(body.created, true);
  assert.equal(body.senderAddress, SENDER);
  assert.equal(body.recipientAddress, RECIPIENT);
  assert.equal(body.payment.status, "pending");
  assert.equal(body.payment.tx_hash, null);
  const replay = await prepare(request(prepareBody({ toUsername: "bob" })));
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).created, false);
  assert.equal(tables.transactions.length, 1);
});

test("an unresolved send intent prevents a second payment intent for the same sender", async () => {
  const { payment } = await preparedPayment();
  const second = await prepare(request(prepareBody({ clientReference: SECOND_REFERENCE, amount: "2" })));
  assert.equal(second.status, 409);
  assert.match((await second.json()).error, /previous payment is still pending/i);
  assert.equal(tables.transactions.length, 1);
  assert.equal(tables.transactions[0].id, payment.id);
});

test("simultaneous sends with different references still create only one active intent", async () => {
  const [first, second] = await Promise.all([
    prepare(request(prepareBody())),
    prepare(request(prepareBody({ clientReference: SECOND_REFERENCE, amount: "2" }))),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [201, 409]);
  assert.equal(tables.transactions.length, 1);
});

test("the authenticated sender can restore a pending payment after losing browser recovery state", async () => {
  const { payment } = await preparedPayment();
  const response = await getOpenPayment(request(undefined));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.payment.id, payment.id);
  assert.equal(body.toUsername, "bob");
  assert.equal((await getOpenPayment(request(undefined, "account-b"))).status, 200);
  assert.equal((await (await getOpenPayment(request(undefined, "account-b"))).json()).payment, null);
  assert.equal((await getOpenPayment(request(undefined, "nope"))).status, 401);
});

test("request send intents must match the authenticated payer, requester, and exact amount", async () => {
  tables.requests.push({ id: REQUEST_ID, requester_id: B, payer_id: A, amount: "1.25", status: "pending" });
  const OTHER_REQUEST_ID = "40000000-0000-4000-8000-000000000002";
  tables.requests.push({ id: OTHER_REQUEST_ID, requester_id: B, payer_id: B, amount: "1.25", status: "pending" });
  const valid = await prepare(request(prepareBody({ requestId: REQUEST_ID })));
  assert.equal(valid.status, 201);
  assert.equal((await valid.json()).payment.request_id, REQUEST_ID);
  tables.transactions = [];
  for (const overrides of [
    { requestId: OTHER_REQUEST_ID },
    { requestId: REQUEST_ID, amount: "1.26" },
    { requestId: "40000000-0000-4000-8000-000000000003" },
  ]) {
    assert.equal((await prepare(request(prepareBody({ clientReference: SECOND_REFERENCE, ...overrides })))).status, 409);
  }
  assert.equal(tables.transactions.length, 0);
});

test("invalid, self, missing, and unauthenticated recipients are rejected", async () => {
  for (const body of [prepareBody({ amount: "0" }), prepareBody({ amount: "1.1234567" }), prepareBody({ note: "x".repeat(141) }), prepareBody({ note: 12 }), prepareBody({ toUsername: "alice" }), prepareBody({ toUsername: "missing" })]) {
    const response = await prepare(request(body));
    assert.ok(response.status >= 400, JSON.stringify(body));
  }
  assert.equal((await prepare(request(prepareBody(), "nope"))).status, 401);
  assert.equal(tables.transactions.length, 0);
});

test("only a verified USDC Transfer log records a payment as confirmed, and retries reuse it", async () => {
  const { payment } = await preparedPayment();
  receipts.set(HASH, successReceipt());
  const first = await byId(record, payment.id, { txHash: HASH });
  assert.equal(first.status, 200);
  const recordBody = await first.json();
  assert.equal(recordBody.payment.status, "confirmed");
  assert.equal(recordBody.payment.tx_hash, HASH);
  const again = await byId(record, payment.id, { txHash: HASH });
  assert.equal(again.status, 200);
  assert.equal(tables.transactions.length, 1);
});

test("arbitrary hashes remain unattached and a transfer to the wrong wallet is rejected", async () => {
  const { payment } = await preparedPayment();
  const unknown = await byId(record, payment.id, { txHash: HASH });
  assert.equal(unknown.status, 202);
  assert.equal((await unknown.json()).payment.tx_hash, null);
  receipts.set(OTHER_HASH, successReceipt(SENDER, SENDER));
  const mismatch = await byId(record, payment.id, { txHash: OTHER_HASH });
  assert.equal(mismatch.status, 409);
  assert.equal(tables.transactions[0].tx_hash, null);
  assert.equal((await byId(getPayment, payment.id)).status, 200);
  assert.equal((await byId(getPayment, payment.id, undefined, "account-b")).status, 403);
});

test("confirmation requires the exact amount, USDC contract, and Base Sepolia chain", async () => {
  const { payment } = await preparedPayment();
  receipts.set(HASH, successReceipt(SENDER, RECIPIENT, BigInt(1_250_001)));
  assert.equal((await byId(record, payment.id, { txHash: HASH })).status, 409);
  receipts.set(HASH, successReceipt(SENDER, RECIPIENT, BigInt(1_250_000), "0x4444444444444444444444444444444444444444" as Address));
  assert.equal((await byId(record, payment.id, { txHash: HASH })).status, 409);
  mockedChainId = 1;
  receipts.set(HASH, successReceipt());
  assert.equal((await byId(record, payment.id, { txHash: HASH })).status, 503);
  assert.equal(tables.transactions[0].status, "pending");
  assert.equal(tables.transactions[0].tx_hash, null);
});

test("a different authenticated user cannot record a transaction against another sender's intent", async () => {
  const { payment } = await preparedPayment();
  receipts.set(HASH, successReceipt());
  const response = await byId(record, payment.id, { txHash: HASH }, "account-b");
  assert.equal(response.status, 403);
  assert.equal(tables.transactions[0].tx_hash, null);
});

test("a reverted matching transfer is recorded failed only when its call data is verified", async () => {
  const { payment } = await preparedPayment();
  receipts.set(HASH, { status: "reverted", logs: [] });
  transactions.set(HASH, directTransfer());
  const failed = await byId(record, payment.id, { txHash: HASH });
  assert.equal(failed.status, 200);
  assert.equal((await failed.json()).payment.status, "failed");
  assert.equal(tables.transactions[0].tx_hash, HASH);
});

test("a failed ERC-4337 operation from the sender is recorded failed from its EntryPoint event", async () => {
  const { payment } = await preparedPayment();
  receipts.set(HASH, failedUserOperationReceipt());
  const failed = await byId(record, payment.id, { txHash: HASH });
  assert.equal(failed.status, 200);
  assert.equal((await failed.json()).payment.status, "failed");
  assert.equal(tables.transactions[0].tx_hash, HASH);
});

test("EntryPoint events from another wallet or a successful operation do not mark this payment failed", async () => {
  const { payment } = await preparedPayment();
  receipts.set(HASH, failedUserOperationReceipt(RECIPIENT));
  assert.equal((await byId(record, payment.id, { txHash: HASH })).status, 409);
  receipts.set(OTHER_HASH, failedUserOperationReceipt(SENDER, true));
  assert.equal((await byId(record, payment.id, { txHash: OTHER_HASH })).status, 409);
  assert.equal(tables.transactions[0].status, "pending");
  assert.equal(tables.transactions[0].tx_hash, null);
});

test("database failure leaves the pending intent retryable and never trusts client status", async () => {
  const { payment } = await preparedPayment();
  receipts.set(HASH, successReceipt());
  failUpdateInto = "transactions";
  const failedWrite = await byId(record, payment.id, { txHash: HASH });
  assert.equal(failedWrite.status, 500);
  assert.doesNotMatch(await failedWrite.text(), /private database detail/);
  assert.equal(tables.transactions[0].status, "pending");
  failUpdateInto = null;
  const retry = await byId(record, payment.id, { txHash: HASH });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).payment.status, "confirmed");
  assert.equal(tables.transactions.length, 1);
});

test("confirming a request payment settles the request, and it can't be paid again", async () => {
  tables.requests.push({ id: REQUEST_ID, requester_id: B, payer_id: A, amount: "1.25", status: "pending" });
  const prepared = await prepare(request(prepareBody({ requestId: REQUEST_ID })));
  const { payment } = await prepared.json();
  receipts.set(HASH, successReceipt());
  assert.equal((await byId(record, payment.id, { txHash: HASH })).status, 200);
  assert.equal(tables.requests[0].status, "paid");
  const again = await prepare(request(prepareBody({ requestId: REQUEST_ID, clientReference: SECOND_REFERENCE })));
  assert.equal(again.status, 409);
  assert.equal(tables.transactions.length, 1);
});

test("a confirmed payment heals a request left pending and blocks a second send", async () => {
  tables.requests.push({ id: REQUEST_ID, requester_id: B, payer_id: A, amount: "1.25", status: "pending" });
  tables.transactions.push({ id: "tx-1", from_user: A, to_user: B, amount: "1.25", note: "lunch", tx_hash: HASH,
    status: "confirmed", request_id: REQUEST_ID, client_reference: REFERENCE, created_at: "2026-11-04T00:00:00.000Z" });
  const again = await prepare(request(prepareBody({ requestId: REQUEST_ID, clientReference: SECOND_REFERENCE })));
  assert.equal(again.status, 409);
  assert.equal(tables.requests[0].status, "paid");
  assert.equal(tables.transactions.length, 1);
});

test("cancelling records a matching on-chain transfer instead of allowing a second send", async () => {
  const { payment } = await preparedPayment();
  receipts.set(HASH, successReceipt());
  chainLogs = [{ args: { value: BigInt(999) }, transactionHash: OTHER_HASH }, { args: { value: BigInt(1_250_000) }, transactionHash: HASH }];
  const response = await byId(record, payment.id, { action: "cancel", immediate: true });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.payment.status, "confirmed");
  assert.equal(body.payment.tx_hash, HASH);
});

test("an earlier, already-recorded transfer of the same amount doesn't block cancelling", async () => {
  tables.transactions.push({ id: "tx-old", from_user: A, to_user: B, amount: "1.25", note: null, tx_hash: OTHER_HASH,
    status: "confirmed", request_id: null, client_reference: null, created_at: "2026-11-03T23:58:00.000Z" });
  const { payment } = await preparedPayment();
  chainLogs = [{ args: { value: BigInt(1_250_000) }, transactionHash: OTHER_HASH }];
  const response = await byId(record, payment.id, { action: "cancel", immediate: true });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).payment.status, "failed");
});

test("a manual cancel waits a few minutes in case the transfer is still landing", async () => {
  const { payment } = await preparedPayment();
  const row = tables.transactions.find((t) => t.id === payment.id)!;
  row.created_at = new Date().toISOString();
  assert.equal((await byId(record, payment.id, { action: "cancel" })).status, 409);
  row.created_at = new Date(Date.now() - 10 * 60_000).toISOString();
  assert.equal((await byId(record, payment.id, { action: "cancel" })).status, 200);
});

test("unsubmitted intents can be cancelled after a rejected wallet prompt", async () => {
  const { payment } = await preparedPayment();
  const response = await byId(record, payment.id, { action: "cancel", immediate: true });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).payment.status, "failed");
  assert.equal((await byId(record, payment.id, { txHash: HASH })).status, 200);
});
