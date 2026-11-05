import assert from "node:assert/strict";
import { test } from "node:test";
import { getUsdcBalance as readBalance, formatUsdcBalance, BASE_SEPOLIA_USDC_ADDRESS, CHAIN_ID } from "../src/lib/chain";

let chainId=1;
let decimals=6;
let units=BigInt("12500000");
let rpcFailure=false;
const calls: {functionName:string;address?:string;args?:unknown[]}[]=[];
// A fake RPC client passed in directly, so no network call can happen whatever the Node version.
const fakeClient={
  getChainId:async()=>chainId,
  readContract:async(input:{functionName:string;address:string;args?:unknown[]})=>{
    calls.push(input);
    if(rpcFailure)throw new Error("RPC unavailable");
    return input.functionName==='decimals'?decimals:units;
  },
} as unknown as Parameters<typeof readBalance>[1];
const getUsdcBalance=(address:`0x${string}`)=>readBalance(address,fakeClient);
const wallet='0x1111111111111111111111111111111111111111';
test('rejects other networks and invalid decimals; configuration retries after failure',async()=>{
  assert.equal(CHAIN_ID,84532);
  await assert.rejects(getUsdcBalance(wallet),/network or decimals/);
  chainId=84532;decimals=18;
  await assert.rejects(getUsdcBalance(wallet),/network or decimals/);
  decimals=6;rpcFailure=true;
  await assert.rejects(getUsdcBalance(wallet),/RPC unavailable/);
  rpcFailure=false;
});
test('reads the canonical token and correct wallet and caches successful metadata checks',async()=>{
  assert.equal(await getUsdcBalance(wallet),BigInt("12500000"));
  const before=calls.filter(c=>c.functionName==='decimals').length;
  units=BigInt("0");
  assert.equal(await getUsdcBalance(wallet),BigInt("0"));
  assert.equal(calls.filter(c=>c.functionName==='decimals').length,before);
  const read=calls.at(-1)!;
  assert.equal(read.functionName,'balanceOf');
  assert.equal(read.address,BASE_SEPOLIA_USDC_ADDRESS);
  assert.deepEqual(read.args,[wallet]);
});
test('formats zero, positive, tiny, large, and fractional balances without Number precision loss',()=>{
  assert.equal(formatUsdcBalance(BigInt("0")),'0.00');
  assert.equal(formatUsdcBalance(BigInt("12500000")),'12.50');
  assert.equal(formatUsdcBalance(BigInt("1")),'0.000001');
  assert.equal(formatUsdcBalance(BigInt("123456789")),'123.456789');
  assert.equal(formatUsdcBalance(BigInt("9007199254740993123456")),'9007199254740993.123456');
});
