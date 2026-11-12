import assert from 'node:assert/strict';
import {withBrowserFixture} from './browser-fixture.mjs';
const old='0x1111111111111111111111111111111111111111';
const current='0x2222222222222222222222222222222222222222';
await withBrowserFixture('week4-wallet',`import React from 'react';import {createRoot} from 'react-dom/client';import {useUsdcBalance} from './src/features/auth/useUsdcBalance';function Probe(){const result=useUsdcBalance('${old}');return <output data-testid="balance">{result.balance??'No current balance'}</output>;}createRoot(document.getElementById('root')).render(<Probe/>);`,{
  '@privy-io/react-auth':`export const usePrivy=()=>({ready:true,authenticated:true,user:{id:'new-account',linkedAccounts:[{type:'smart_wallet',address:'${current}'}]}});`,
  '@/lib/chain':`export const formatUsdcBalance=()=> '99.00';export async function getUsdcBalance(address){window.reads=(window.reads??[]).concat(address);return BigInt('99000000');}`,
},async({page,origin})=>{
  await page.goto(origin);await page.getByTestId('balance').waitFor();await page.waitForTimeout(100);
  assert.deepEqual(await page.evaluate(()=>window.reads??[]),[],'A caller passing a stale SDK address must not trigger a previous-account read.');
  assert.equal(await page.getByTestId('balance').innerText(),'No current balance');
  console.log('PASS: direct balance-hook callers cannot read/display a previous account wallet, even while their SDK client is stale. Controlled wallet/RPC fixture.');
});
