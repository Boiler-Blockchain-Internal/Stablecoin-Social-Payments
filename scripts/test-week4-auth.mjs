import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {authFixture,withBrowserFixture} from './browser-fixture.mjs';

await withBrowserFixture('week4-auth',`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {UsernameOnboarding} from './src/features/auth/UsernameOnboarding';function App(){const [visible,setVisible]=useState(true);window.hideForm=()=>setVisible(false);return visible?<UsernameOnboarding onSaved={()=>{window.saved=(window.saved??0)+1;}}/>:<p>Signed out</p>;}createRoot(document.getElementById('root')).render(<main className="mx-auto max-w-xl p-4"><App/></main>);`,{
  '@privy-io/react-auth':authFixture,
},async({page,origin,directory})=>{
  await page.goto(origin);
  await page.evaluate(()=>{
    window.saved=0;
    window.fetch=()=>new Promise(resolve=>{window.completeSave=()=>resolve(new Response(JSON.stringify({user:{id:'fixture',privy_id:'new',username:'test_user',wallet_address:null,created_at:'2026-11-11T00:00:00Z'}}),{headers:{'Content-Type':'application/json'}}));});
  });
  await page.getByLabel('Username',{exact:true}).fill('test_user');
  await page.getByRole('button',{name:'Save and continue'}).click();
  await page.getByRole('button',{name:'Saving username…'}).waitFor();
  await page.evaluate(()=>window.hideForm());
  await page.getByText('Signed out',{exact:true}).waitFor();
  await page.evaluate(()=>window.completeSave());
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>window.saved),0,'A response after logout/unmount must not run onSaved or redirect the next user.');
  if(process.argv.includes('--repro-only'))return;
  await page.reload();
  await page.clock.install();
  await page.evaluate(()=>{
    window.fetch=(_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))));
  });
  await page.getByLabel('Username',{exact:true}).fill('test_user');
  await page.getByRole('button',{name:'Save and continue'}).click();
  await page.clock.fastForward(15001);
  await page.getByRole('alert').filter({hasText:'took too long'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Save and continue'}).isEnabled(),true);
  await page.screenshot({path:resolve(directory,'onboarding-timeout-mobile.png'),fullPage:true});
  await page.clock.resume();
  let submits=0;
  await page.route('**/api/users/username',async route=>{submits++;await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'That username is already taken.'})});});
  await page.evaluate(()=>{delete window.fetch;});
  // Reload restores the browser fetch function after the stalled transport fixture.
  await page.reload();
  await page.getByLabel('Username',{exact:true}).fill('taken');
  await page.getByRole('button',{name:'Save and continue'}).click();
  await page.getByRole('alert').filter({hasText:'already taken'}).waitFor();
  assert.equal(submits,1);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  console.log('PASS: no save/redirect after unmount, bounded username request with retryable feedback, conflict feedback, and mobile fit. Mocked services.');
});
