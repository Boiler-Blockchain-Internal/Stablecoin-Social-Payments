import assert from "node:assert/strict";
import { test } from "node:test";
import { linkedSmartWalletAddress } from "../src/features/auth/linkedSmartWallet";

const address="0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
test("accepts only the current owner's matching smart wallet, case-insensitively",()=>{
  assert.equal(linkedSmartWalletAddress({linkedAccounts:[{type:"smart_wallet",address:address.toLowerCase()}]},address),address);
});
test("does not accept the embedded signer or an unrelated previous-user client",()=>{
  assert.equal(linkedSmartWalletAddress({linkedAccounts:[{type:"wallet",address}]},address),undefined);
  assert.equal(linkedSmartWalletAddress({linkedAccounts:[{type:"smart_wallet",address:"0x1111111111111111111111111111111111111111"}]},address),undefined);
});
test("handles missing identity, wallet and delayed linked-account metadata",()=>{
  assert.equal(linkedSmartWalletAddress(null,address),undefined);
  assert.equal(linkedSmartWalletAddress(undefined,address),undefined);
  assert.equal(linkedSmartWalletAddress({linkedAccounts:[]},address),undefined);
  assert.equal(linkedSmartWalletAddress({linkedAccounts:[]},undefined),undefined);
});
test("ignores unrelated account types without addresses",()=>{
  assert.equal(linkedSmartWalletAddress({linkedAccounts:[{type:"email"},{type:"smart_wallet",address}]},address),address);
});
