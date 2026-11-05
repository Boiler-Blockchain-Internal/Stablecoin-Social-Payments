import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { withBrowserFixture } from './browser-fixture.mjs';

const a='0x1111111111111111111111111111111111111111';
const b='0x2222222222222222222222222222222222222222';
await withBrowserFixture('balance-week3',`import React from 'react';import {createRoot} from 'react-dom/client';import {WalletCard} from './src/features/auth/WalletCard';createRoot(document.getElementById('root')).render(<main className="mx-auto max-w-xl p-4"><WalletCard/></main>);`,{
  '@privy-io/react-auth':`import {useSyncExternalStore} from 'react';let state={ready:true,authenticated:true,user:{id:'a',linkedAccounts:[{type:'smart_wallet',address:'${a}'}]},clientAddress:'${a}'};
    window.fixtureState=()=>state;window.setWallet=(id,address,linked=true)=>{state={ready:true,authenticated:!!id,user:id?{id,linkedAccounts:linked&&address?[{type:'smart_wallet',address}]:[]}:null,clientAddress:address};window.dispatchEvent(new Event('auth'));};
    const subscribe=fn=>{window.addEventListener('auth',fn);return()=>window.removeEventListener('auth',fn);};export function usePrivy(){return useSyncExternalStore(subscribe,()=>state);}`,
  '@privy-io/react-auth/smart-wallets':`import {useSyncExternalStore} from 'react';const subscribe=fn=>{window.addEventListener('auth',fn);return()=>window.removeEventListener('auth',fn);};export function useSmartWallets(){const state=useSyncExternalStore(subscribe,window.fixtureState);return {client:state.clientAddress?{account:{address:state.clientAddress}}:undefined};}`,
  '@/lib/chain':`export {formatUsdcBalance} from './src/lib/chain';export async function getUsdcBalance(address){const r=await fetch('/fixture-balance?address='+address);if(!r.ok)throw new Error('RPC failed');return BigInt((await r.json()).units);}`,
},async({page,origin,directory})=>{
  let units='12500000';let fail=false;let delay=0;const addresses=[];
  await page.route('**/fixture-balance?*',async route=>{
    const address=new URL(route.request().url()).searchParams.get('address');addresses.push(address);
    const amount=units;const wait=delay;
    if(wait)await new Promise(done=>setTimeout(done,wait));
    try{await route.fulfill({status:fail?500:200,contentType:'application/json',body:JSON.stringify({units:amount})});}catch{}
  });
  await page.goto(origin);
  const balance=page.getByTestId('usdc-balance');
  await balance.filter({hasText:'12.50 USDC'}).waitFor();
  assert.equal(addresses[0],a);
  assert.equal(await page.getByTestId('smart-wallet-address').innerText(),a);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:resolve(directory,'balance-mobile.png'),fullPage:true});
  for(const [raw,formatted] of [['0','0.00 USDC'],['1','0.000001 USDC'],['9007199254740993123456','9007199254740993.123456 USDC']]){
    units=raw;await page.getByRole('button',{name:'Refresh',exact:true}).click();await balance.filter({hasText:formatted}).waitFor();
  }
  fail=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('alert').waitFor();
  fail=false;units='2000000';delay=800;
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await balance.filter({hasText:'Loading balance'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Refreshing…',exact:true}).isDisabled(),true);
  units='3000000';delay=0;
  await page.evaluate(address=>window.setWallet('b',address),b);
  await balance.filter({hasText:'3.00 USDC'}).waitFor();await page.waitForTimeout(900);
  assert.equal(await balance.innerText(),'3.00 USDC');
  assert.equal(addresses.at(-1),b);
  const count=addresses.length;
  await page.evaluate(address=>window.setWallet('b',address,false),a); // Old client's address is not linked to new user.
  await balance.filter({hasText:'Wallet not ready'}).waitFor();
  assert.equal(addresses.length,count);
  await page.evaluate(()=>window.setWallet('b',undefined));await balance.filter({hasText:'Wallet not ready'}).waitFor();
  await page.evaluate(()=>window.setWallet(null,undefined));await page.getByText('Log in with email or Google').waitFor();
  assert.equal(await balance.count(),0);
  console.log('PASS: real wallet selector/hook/display: positive, zero, tiny/large fractions, refresh, RPC failure/retry, pending account switch, mismatched/missing wallet, sign-out, and mobile fit. Mocked RPC.');
});
