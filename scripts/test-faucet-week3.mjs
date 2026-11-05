import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { withBrowserFixture } from './browser-fixture.mjs';

const a='0x1111111111111111111111111111111111111111';
const b='0x2222222222222222222222222222222222222222';
await withBrowserFixture('faucet-week3',`import React from 'react';import {createRoot} from 'react-dom/client';import {WalletCard} from './src/features/auth/WalletCard';createRoot(document.getElementById('root')).render(<main className="mx-auto max-w-xl p-4"><WalletCard/></main>);`,{
  '@privy-io/react-auth':`import {useSyncExternalStore} from 'react';let state={ready:true,authenticated:true,user:{id:'a',linkedAccounts:[{type:'smart_wallet',address:'${a}'}]},clientAddress:'${a}'};window.fixtureState=()=>state;window.setWallet=address=>{state={...state,user:{id:address??'none',linkedAccounts:address?[{type:'smart_wallet',address}]:[]},clientAddress:address};window.dispatchEvent(new Event('auth'));};const subscribe=fn=>{window.addEventListener('auth',fn);return()=>window.removeEventListener('auth',fn);};export function usePrivy(){return useSyncExternalStore(subscribe,()=>state);}`,
  '@privy-io/react-auth/smart-wallets':`import {useSyncExternalStore} from 'react';const subscribe=fn=>{window.addEventListener('auth',fn);return()=>window.removeEventListener('auth',fn);};export function useSmartWallets(){const state=useSyncExternalStore(subscribe,window.fixtureState);return {client:state.clientAddress?{account:{address:state.clientAddress}}:undefined};}`,
  '@/lib/chain':`import {fromUsdcUnits} from './src/lib/chain';export {fromUsdcUnits};export function formatUsdcBalance(units){const [whole,fraction='']=fromUsdcUnits(units).split('.');return whole+'.'+fraction.padEnd(2,'0');}export async function getUsdcBalance(address){const r=await fetch('/fixture-balance?address='+address);return BigInt((await r.json()).units);}`,
},async({page,browser,origin,directory})=>{
  let funded=false;const reads=[];
  await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{if(window.copyFailure)throw new Error('Denied');window.copiedAddress=value;},readText:async()=>window.copiedAddress}});});
  await page.route('**/fixture-balance?*',async route=>{reads.push(new URL(route.request().url()).searchParams.get('address'));await route.fulfill({contentType:'application/json',body:JSON.stringify({units:funded?'20000000':'0'})});});
  // The external page is mocked; no real faucet or CAPTCHA interaction occurs.
  await page.context().route('https://faucet.circle.com/**',route=>route.fulfill({contentType:'text/html',body:'<p>Official faucet link target fixture</p>'}));
  await page.goto(origin);
  await page.getByTestId('usdc-balance').filter({hasText:'0'}).waitFor();
  assert.equal(await page.getByTestId('smart-wallet-address').innerText(),a);
  await page.getByRole('button',{name:'Copy wallet address'}).click();
  await page.getByRole('status').filter({hasText:'Wallet address copied'}).waitFor();
  assert.equal(await page.evaluate(()=>window.copiedAddress),a);
  const link=page.getByRole('link',{name:/Get Test USDC/});
  assert.equal(await link.getAttribute('href'),'https://faucet.circle.com/');
  assert.equal(await link.getAttribute('target'),'_blank');
  assert.equal(await link.getAttribute('rel'),'noopener noreferrer');
  const popupPromise=page.waitForEvent('popup');await link.click();const popup=await popupPromise;
  await popup.waitForLoadState();assert.equal(new URL(popup.url()).origin,'https://faucet.circle.com');await popup.close();
  await page.getByText('Base Sepolia testnet only.',{exact:false}).waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:resolve(directory,'faucet-mobile.png'),fullPage:true});
  await page.evaluate(()=>{window.copyFailure=true;});await page.getByRole('button',{name:'Copy wallet address'}).click();
  await page.getByRole('alert').filter({hasText:'copy it manually'}).waitFor();
  await page.evaluate(address=>{window.copyFailure=false;window.setWallet(address);},b);
  assert.equal(await page.getByRole('status').filter({hasText:'Wallet address copied'}).count(),0);
  await page.getByRole('button',{name:'Copy wallet address'}).click();
  await page.getByRole('status').filter({hasText:'Wallet address copied'}).waitFor();
  assert.equal(await page.evaluate(()=>window.copiedAddress),b);
  funded=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await page.getByTestId('usdc-balance').filter({hasText:'20'}).waitFor();assert.equal(reads.at(-1),b);
  await page.evaluate(()=>window.setWallet(undefined));
  await page.getByRole('status').filter({hasText:'Wait for your smart wallet'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Copy wallet address'}).isDisabled(),true);
  assert.equal(await link.count(),0);
  const actualClipboard=await browser.newPage({viewport:{width:375,height:812}});
  await actualClipboard.context().grantPermissions(['clipboard-read','clipboard-write'],{origin});
  await actualClipboard.route('**/fixture-balance?*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({units:'0'})}));
  await actualClipboard.goto(origin);
  await actualClipboard.getByRole('button',{name:'Copy wallet address'}).click();
  await actualClipboard.getByRole('status').filter({hasText:'Wallet address copied'}).waitFor();
  assert.equal(await actualClipboard.evaluate(()=>navigator.clipboard.readText()),a);
  await actualClipboard.close();
  console.log('PASS: real Chromium Clipboard API round-trip on localhost fixture with explicit browser-test permission.');
  console.log('PASS: correct public address, clipboard success/failure and reset, official new-tab target, network/test-funds instructions, refresh after simulated funding, missing wallet, mobile fit. Faucet and clipboard permissions are mocked.');
});
