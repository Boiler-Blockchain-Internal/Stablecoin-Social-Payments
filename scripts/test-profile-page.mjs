// Real profile component, Week 1 hook and onboarding; mocked Privy/API, not live login.
// After npm run build: npx --yes --package=playwright --package=node@24 -c "node scripts/test-profile-page.mjs"
import { build } from "esbuild";
import { access, glob, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { delimiter, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

let playwright;
for (const bin of process.env.PATH.split(delimiter)) {
  const candidate = resolve(bin, "../playwright/index.mjs");
  try { await access(candidate); playwright = candidate; break; } catch {}
}
if (!playwright) throw new Error("Run with Playwright on PATH; install Chromium first.");
const { chromium } = await import(pathToFileURL(playwright).href);
const directory = resolve(".next/profile-fixture");
await mkdir(directory, { recursive: true });
await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {ProfileDetails} from './src/features/auth/ProfileDetails'; createRoot(document.getElementById('root')).render(<ProfileDetails/>);`, resolveDir: process.cwd(), loader: "tsx" },
  bundle: true, jsx: "automatic", define: { "process.env": JSON.stringify({ NODE_ENV: "development" }) }, outfile: resolve(directory, "fixture.js"),
  plugins: [{ name: "mock-privy", setup(builder) {
    builder.onResolve({ filter: /^@privy-io\/react-auth$/ }, () => ({ path: "privy", namespace: "fixture" }));
    // Wallet behavior has its own full component/RPC suite; isolate profile tests.
    builder.onResolve({ filter: /^\.\/WalletCard$/ }, () => ({ path: "wallet", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ resolveDir: process.cwd(), contents: path === "wallet" ? "export function WalletCard(){return null;}" : `
      import {useSyncExternalStore} from 'react';
      const makeState=(account,ready=true)=>({ready,authenticated:account!=='signed-out',user:account==='signed-out'?null:{id:account}});
      let state=makeState(new URLSearchParams(location.search).get('account')??'account-a');
      window.setFixtureAccount=(account,ready=true)=>{state=makeState(account,ready);history.replaceState(null,'','?account='+account);window.dispatchEvent(new Event('auth'));};
      const subscribe=fn=>{window.addEventListener('auth',fn);return()=>window.removeEventListener('auth',fn);};
      const getAccessToken=async()=>state.user?.id??null;
      export function usePrivy(){return {...useSyncExternalStore(subscribe,()=>state),getAccessToken};}
    ` }));
  } }],
});
let styles = "";
for await (const file of glob(".next/static/**/*.css")) styles += await readFile(file, "utf8");
await writeFile(resolve(directory, "index.html"), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style></head><body class="bg-zinc-50 p-4 text-zinc-900"><main class="mx-auto max-w-xl" id="root"></main><script src="fixture.js"></script></body></html>`);
const server = createServer(async (request, response) => {
  const script = request.url === "/fixture.js";
  response.setHeader("Content-Type", script ? "text/javascript" : "text/html");
  response.end(await readFile(resolve(directory, script ? "fixture.js" : "index.html")));
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => console.error("Fixture browser error:", error.message));
  let fail = false;
  let requests = 0;
  const names = { "account-a": "rithvik_123", "account-b": "second_user", "new": null, "slow": "stale_user" };
  const row = account => ({ id: account, privy_id: account, username: names[account], wallet_address: "private-wallet", created_at: "2026-10-22T12:00:00Z" });
  await page.route("**/api/users/sync", async route => {
    requests++;
    const account = route.request().headers().authorization?.slice(7);
    assert.ok(Object.hasOwn(names, account));
    if (account === "slow") await new Promise(done => setTimeout(done, 1000));
    try { await route.fulfill({ status: fail ? 500 : 200, contentType: "application/json", body: JSON.stringify(fail ? {error:"Unable to sync profile. Please try again."} : {user:row(account)}) }); } catch {}
  });
  await page.route("**/api/users/username", async route => {
    const account = route.request().headers().authorization.slice(7);
    names[account] = route.request().postDataJSON().username;
    await route.fulfill({contentType:"application/json",body:JSON.stringify({user:row(account)})});
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(`${origin}?account=signed-out`);
  await page.getByText("Log in using the button above").waitFor();
  assert.equal(requests, 0);
  await page.evaluate(()=>window.setFixtureAccount('account-a',false));
  await page.getByRole('status').filter({hasText:'Loading session'}).waitFor();
  assert.equal(requests, 0);
  await page.evaluate(()=>window.setFixtureAccount('account-a'));
  await page.getByTestId('profile-username').filter({hasText:'@rithvik_123'}).waitFor();
  await page.getByText('Oct 22, 2026').waitFor();
  assert.doesNotMatch(await page.locator('body').innerText(), /private-wallet|second_user/);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:resolve(directory,'profile-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1280,height:800});
  await page.screenshot({path:resolve(directory,'profile-desktop.png'),fullPage:true});
  await page.reload();
  await page.getByTestId('profile-username').filter({hasText:'@rithvik_123'}).waitFor();
  const slowRequest = page.waitForRequest(request=>request.url().endsWith('/api/users/sync') && request.headers().authorization==='Bearer slow');
  await page.evaluate(()=>window.setFixtureAccount('slow'));
  await slowRequest;
  await page.evaluate(()=>window.setFixtureAccount('account-b'));
  await page.getByTestId('profile-username').filter({hasText:'@second_user'}).waitFor();
  await page.waitForTimeout(1100);
  assert.equal(await page.getByTestId('profile-username').innerText(), '@second_user');
  await page.evaluate(()=>window.setFixtureAccount('signed-out'));
  assert.equal(await page.getByTestId('profile-username').count(), 0);
  await page.evaluate(()=>window.setFixtureAccount('new'));
  await page.getByRole('heading',{name:'Choose your username'}).waitFor();
  await page.getByLabel('Username',{exact:true}).fill('new_user');
  await page.getByRole('button',{name:'Save and continue'}).click();
  await page.getByTestId('profile-username').filter({hasText:'@new_user'}).waitFor();
  await page.reload();
  await page.getByTestId('profile-username').filter({hasText:'@new_user'}).waitFor();
  fail = true;
  await page.getByRole('button',{name:'Refresh profile'}).click();
  await page.getByRole('alert').filter({hasText:'Unable to sync profile'}).waitFor({timeout:30000});
  fail = false;
  await page.getByRole('button',{name:'Retry profile',exact:true}).click();
  await page.getByRole('alert').waitFor({state:'detached'});
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Refresh profile')?.disabled===false);
  if (process.argv.includes('--live')) {
    const live = await browser.newPage({viewport:{width:375,height:812}});
    await live.goto('http://localhost:3000/profile');
    await live.getByRole('heading',{name:'Your profile',exact:true}).waitFor();
    await live.getByText('Log in using the button above').waitFor();
    await live.getByRole('button',{name:'Log in',exact:true}).waitFor();
    assert.equal(await live.getByTestId('profile-username').count(),0);
    for (const headers of [{},{Authorization:'Bearer invalid'}]) {
      const response = await live.request.post('http://localhost:3000/api/users/sync',{headers});
      assert.equal(response.status(),401);
    }
    console.log('PASS: actual localhost /profile renders signed-out UI, existing login button, and no profile data; missing/invalid sync tokens return 401.');
  }
  console.log('PASS: signed-out/session loading, own profile, different account, reload, onboarding persistence, stale account response, sign-out clearing, database failure/retry, 375px layout. Mocked service boundaries.');
} finally { await browser.close(); server.close(); }
