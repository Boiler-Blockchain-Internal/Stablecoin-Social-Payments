import assert from "node:assert/strict";
import { resolve } from "node:path";
import { authFixture, withBrowserFixture } from "./browser-fixture.mjs";

await withBrowserFixture("onboarding-week3", `import React from 'react'; import {createRoot} from 'react-dom/client'; import {AuthProfileBoundary} from './src/features/auth/AuthProfileBoundary'; createRoot(document.getElementById('root')).render(<AuthProfileBoundary><p data-testid="protected">Feature content</p></AuthProfileBoundary>);`, {
  "@privy-io/react-auth": authFixture,
  "./useSmartWalletAddress": "export const useSmartWalletAddress=()=>undefined;",
  "next/navigation": "export const usePathname=()=>location.pathname; const router={replace:path=>{window.redirects=(window.redirects??0)+1;history.replaceState(null,'',path);}}; export const useRouter=()=>router;",
}, async ({page, origin, directory}) => {
  const rows = {new:null, returning:'returning_user', other:null};
  let syncError = false;
  let syncs = 0;
  await page.route('**/api/users/sync', async route => {
    syncs++;
    const account=route.request().headers().authorization.slice(7);
    await route.fulfill({status:syncError?500:200,contentType:'application/json',body:JSON.stringify(syncError?{error:'Unable to sync profile. Please try again.'}:{user:{id:account,privy_id:account,username:rows[account],wallet_address:null,created_at:'2026-11-04T00:00:00Z'}})});
  });
  await page.route('**/api/users/username', async route=>{
    const account=route.request().headers().authorization.slice(7);
    const username=route.request().postDataJSON().username;
    if(username==='taken'){await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'That username is already taken.'})});return;}
    rows[account]=username;
    await route.fulfill({contentType:'application/json',body:JSON.stringify({user:{id:account,privy_id:account,username,wallet_address:null,created_at:'2026-11-04T00:00:00Z'}})});
  });
  await page.goto(`${origin}/test-send`);
  await page.getByRole('heading',{name:'Choose your username'}).waitFor();
  assert.equal(await page.getByTestId('protected').count(),0);
  await page.reload(); await page.getByRole('heading',{name:'Choose your username'}).waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:resolve(directory,'onboarding-mobile.png'),fullPage:true});
  await page.getByLabel('Username',{exact:true}).fill('taken');
  await page.getByRole('button',{name:'Save and continue'}).click();
  await page.getByRole('alert').filter({hasText:'already taken'}).waitFor();
  assert.equal(await page.getByTestId('protected').count(),0);
  await page.getByLabel('Username',{exact:true}).fill('new_user');
  await page.getByRole('button',{name:'Save and continue'}).click();
  await page.getByTestId('protected').waitFor();
  assert.equal(new URL(page.url()).pathname,'/');
  assert.equal(await page.evaluate(()=>window.redirects),1);
  await page.reload(); await page.getByTestId('protected').waitFor();
  await page.goto(`${origin}/test-send?account=returning`); await page.getByTestId('protected').waitFor();
  assert.equal(new URL(page.url()).pathname,'/test-send');
  await page.evaluate(()=>window.setFixtureAuth({ready:false,authenticated:false,user:null}));
  await page.getByRole('status').filter({hasText:'Loading session'}).waitFor();
  assert.equal(await page.getByTestId('protected').count(),0);
  syncError=true;
  await page.evaluate(()=>window.setFixtureAuth({ready:true,authenticated:true,user:{id:'other'}}));
  await page.getByRole('alert').filter({hasText:'Unable to sync'}).waitFor();
  syncError=false;
  await page.getByRole('button',{name:'Retry profile sync'}).click();
  await page.getByRole('heading',{name:'Choose your username'}).waitFor();
  await page.route('**/api/users/sync', async route=>{
    syncs++;
    await route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'Invalid token'})});
  });
  const expiredBefore=syncs;
  await page.evaluate(()=>window.setFixtureAuth({ready:true,authenticated:true,user:{id:'expired'}}));
  await page.getByRole('alert').filter({hasText:'Session expired'}).waitFor();
  await page.waitForTimeout(2100);
  assert.equal(syncs,expiredBefore+1);
  const before=syncs;
  await page.evaluate(()=>window.setFixtureAuth({ready:true,authenticated:false,user:null}));
  await page.getByTestId('protected').waitFor(); // Existing signed-out pages own their login UI.
  assert.equal(syncs,before);
  console.log('PASS: direct-route gate, onboarding reload, duplicate feedback, save/home navigation once, returning-route preservation, auth initialization, DB failure/retry, sign-out cancellation, mobile fit. Mocked service boundaries.');
});
