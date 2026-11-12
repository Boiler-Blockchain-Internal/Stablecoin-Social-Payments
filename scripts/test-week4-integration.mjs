import assert from 'node:assert/strict';
import {authFixture,withBrowserFixture} from './browser-fixture.mjs';

await withBrowserFixture('week4-integration',`import React from 'react';import {createRoot} from 'react-dom/client';import {Shell} from './src/components/Shell';import {SendScreen} from './src/features/send/SendScreen';import {CreateRequestForm} from './src/features/requests/CreateRequestForm';import {CreateGroupForm} from './src/features/groups/CreateGroupForm';const view=location.pathname==='/send'?<SendScreen/>:location.pathname==='/requests'?<CreateRequestForm/>:<CreateGroupForm myUsername="club_tester"/>;createRoot(document.getElementById('root')).render(<Shell>{view}</Shell>);`,{
  '@privy-io/react-auth':authFixture,
  '@privy-io/react-auth/smart-wallets':"export const useSmartWallets=()=>({client:{account:{address:'0x1111111111111111111111111111111111111111'}}});",
  '@/features/groups/useCurrentUser':"export const useCurrentUser=()=>({ready:true,authenticated:true,user:{id:'11111111-1111-4111-8111-111111111111',username:'club_tester'},error:null});",
  '@/features/requests/useIncomingRequests':"export const useIncomingRequests=()=>({pending:0,notice:null,dismiss:()=>{}});",
  '@/features/send/sendUSDC':"const actions={findOpenPayment:async()=>null,sendUSDC:async()=>{window.transferAttempts=(window.transferAttempts??0)+1;throw new Error('No automated transfers');},retryRecord:async()=>{},cancelPayment:async()=>{}};export const useSendUSDC=()=>actions;export const usePaymentRecovery=()=>null;export const clearPaymentRecovery=()=>{};export const friendlySendError=error=>error.message;",
  '@/lib/chain':"export * from './src/lib/chain';export const getUsdcBalance=async()=>BigInt('50000000');",
  'next/navigation':"export const usePathname=()=>location.pathname;const router={push:path=>{window.lastPush=path;},replace:path=>{window.lastPush=path;}};export const useRouter=()=>router;",
  '@/lib/supabase-browser':`export function getSupabaseBrowser(){return {from(table){if(table!=='users')throw new Error('Unexpected fixture table');let pattern='';let username='';const peer={id:'22222222-2222-4222-8222-222222222222',username:'peer_user'};const q={select:()=>q,neq:()=>q,order:()=>q,limit:()=>q,ilike:(_column,value)=>{pattern=value.replaceAll('%','').replaceAll('\\_','_');return q;},eq:(_column,value)=>{username=value;return q;},abortSignal:async()=>({data:peer.username.includes(pattern)?[peer]:[],error:null}),maybeSingle:async()=>({data:username===peer.username?{id:peer.id}:null,error:null})};return q;}};}`,
},async({page,origin})=>{
  let requestBody=null;let groupBody=null;
  await page.route('**/api/requests',async route=>{assert.equal(route.request().headers().authorization,'Bearer new');requestBody=route.request().postDataJSON();await route.fulfill({contentType:'application/json',body:JSON.stringify({request:{id:'fixture'}})});});
  await page.route('**/api/groups',async route=>{assert.equal(route.request().headers().authorization,'Bearer new');groupBody=route.request().postDataJSON();await route.fulfill({contentType:'application/json',body:JSON.stringify({group:{id:'33333333-3333-4333-8333-333333333333'}})});});
  for(const width of [320,375,390]){
    await page.setViewportSize({width,height:812});
    await page.goto(origin+'/send');
    await page.getByRole('combobox',{name:'Recipient'}).fill('peer');
    await page.getByRole('option',{name:'@peer_user',exact:true}).click();
    await page.getByLabel('Amount',{exact:true}).fill('0.10');
    await page.getByText('0.10 USDC',{exact:false}).waitFor();
    assert.equal(await page.evaluate(()=>window.transferAttempts??0),0);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.goto(origin+'/requests');
    await page.getByRole('combobox',{name:'From'}).fill('peer');
    await page.getByRole('option',{name:'@peer_user',exact:true}).click();
    await page.getByLabel('Amount (USDC)',{exact:true}).fill('0.10');
    await page.getByRole('button',{name:'Send request',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Requested 0.10 USDC from @peer_user'}).waitFor();
    assert.equal(requestBody.toUsername,'peer_user');assert.equal(requestBody.amount,'0.10');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.goto(origin+'/groups/new');
    await page.getByLabel('Group name',{exact:true}).fill('Club fixture');
    await page.getByRole('combobox',{name:'Members'}).fill('peer');
    await page.getByRole('option',{name:'@peer_user',exact:true}).click();
    await page.getByRole('button',{name:'Add',exact:true}).click();
    await page.getByRole('button',{name:'Remove @peer_user',exact:true}).waitFor();
    await page.getByRole('button',{name:'Create group',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Group created'}).waitFor();
    assert.deepEqual(groupBody.members,['peer_user']);
    assert.equal(await page.evaluate(()=>window.lastPush),'/groups/33333333-3333-4333-8333-333333333333');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.equal(await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link').count(),5);
  }
  console.log('PASS: actual Send recipient selection (no transfer), Request creation payload, Groups member/group payload, shared navigation, and 320/375/390px layout. Auth, DB/API and wallet services are controlled fixtures; no real writes or payments.');
});
