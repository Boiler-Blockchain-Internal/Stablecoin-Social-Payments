// Real UserPicker/search helper, mocked Privy and Supabase transport. No live sign-in.
// After npm run build: npx --yes --package=playwright --package=node@24 -c "node scripts/test-user-picker.mjs"
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
if (!playwright) throw new Error("Run with Playwright on PATH; install its Chromium browser first.");
const { chromium } = await import(pathToFileURL(playwright).href);
const directory = resolve(".next/user-picker-fixture");
await mkdir(directory, { recursive: true });
await build({
  stdin: { contents: `import React, {useState} from 'react'; import {createRoot} from 'react-dom/client'; import {UserPicker} from './src/components/UserPicker';
    function App() { const [selected,setSelected]=useState(null); const [text,setText]=useState(''); const legacy=new URLSearchParams(location.search).has('legacy'); return <><UserPicker {...(legacy?{value:text,onChange:setText}:{selectedUser:selected})} onSelect={setSelected}/><output hidden data-testid="selected">{JSON.stringify(selected)}</output></>; }
    createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: process.cwd(), loader: "tsx" },
  bundle: true, jsx: "automatic", outfile: resolve(directory, "fixture.js"),
  plugins: [{ name: "fixture-boundaries", setup(builder) {
    builder.onResolve({ filter: /^@privy-io\/react-auth$/ }, () => ({ path: "privy", namespace: "fixture" }));
    builder.onResolve({ filter: /^@\/lib\/supabase-browser$/ }, () => ({ path: "supabase", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ resolveDir: process.cwd(), contents: path === "privy" ? `
      import {useSyncExternalStore} from 'react';
      let state={ready:true,authenticated:true,user:{id:'self'}};
      window.setFixtureAuth=next=>{state=next;window.dispatchEvent(new Event('auth'));};
      const subscribe=fn=>{window.addEventListener('auth',fn);return()=>window.removeEventListener('auth',fn);};
      export function usePrivy(){return useSyncExternalStore(subscribe,()=>state);}
    ` : `export function getSupabaseBrowser(){return {from(table){const q={table}; const b={};
      for(const name of ['select','ilike','neq','order','limit']) b[name]=(...args)=>{(q[name]??=[]).push(args);return b;};
      b.abortSignal=async signal=>{const r=await fetch('/fixture-search',{method:'POST',body:JSON.stringify(q),signal});return r.json();}; return b;}};}` }));
  } }],
});
let styles = "";
for await (const file of glob(".next/static/**/*.css")) styles += await readFile(file, "utf8");
await writeFile(resolve(directory, "index.html"), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style></head><body class="bg-zinc-50 p-4 text-zinc-900"><main class="mx-auto max-w-xl rounded-2xl border border-zinc-200 bg-white p-6"><h1 class="mb-4 text-xl font-semibold">Choose a recipient</h1><div id="root"></div></main><script src="fixture.js"></script></body></html>`);
const server = createServer(async (request, response) => {
  const script = request.url === "/fixture.js";
  response.setHeader("Content-Type", script ? "text/javascript" : "text/html");
  response.end(await readFile(resolve(directory, script ? "fixture.js" : "index.html")));
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const queries = [];
  let databaseError = false;
  await page.route("**/fixture-search", async route => {
    const query = route.request().postDataJSON();
    queries.push(query);
    const term = query.ilike[0][1].slice(1, -1).replaceAll("\\_", "_");
    if (term === "slow") await new Promise(done => setTimeout(done, 800));
    const users = [{id:'1',username:'alice_one',email:'private@example.com',wallet_address:'private-wallet'}, {id:'2',username:'alicia'}, {id:'3',username:'bob'}, {id:'4',username:'slow_user'}].filter(user=>user.username.includes(term));
    try { await route.fulfill({contentType:'application/json',body:JSON.stringify(databaseError ? {data:null,error:{message:'private detail'}} : {data:users,error:null})}); } catch {}
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const input = page.getByRole("combobox");
  await input.fill("AL");
  await page.getByRole("option", {name:"@alice_one",exact:true}).waitFor();
  assert.equal(await page.getByRole("option").count(), 2);
  assert.ok(queries.every(query=>JSON.stringify(query.select)==='[["id, username"]]' && query.limit[0][0]===8));
  assert.doesNotMatch(await page.locator("body").innerText(), /private@example|private-wallet/);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:resolve(directory,"user-picker-mobile.png"),fullPage:true});
  await input.press("ArrowDown"); await input.press("Enter");
  assert.deepEqual(JSON.parse(await page.getByTestId("selected").textContent()), {id:"1",username:"alice_one"});
  await page.getByRole("button",{name:"Clear",exact:true}).click();
  assert.equal(await input.inputValue(), "");
  assert.equal(await page.getByTestId("selected").textContent(), "null");
  await input.fill("alice_");
  await page.getByRole("option",{name:"@alice_one",exact:true}).waitFor();
  assert.equal(queries.at(-1).ilike[0][1], "%alice\\_%");
  await input.fill("missing"); await page.getByRole("status").filter({hasText:"No users found"}).waitFor();
  await input.fill("slow");
  await page.waitForRequest(request=>request.url().endsWith('/fixture-search') && request.postDataJSON().ilike[0][1]==='%slow%');
  await input.fill("bob"); await page.getByRole("option",{name:"@bob",exact:true}).waitFor();
  await page.waitForTimeout(900);
  assert.equal(await page.getByRole("option").innerText(), "@bob");
  databaseError = true;
  await input.fill("error"); await page.getByRole("alert").filter({hasText:"Unable to search"}).waitFor();
  databaseError = false;
  await page.getByRole("button",{name:"Retry search"}).click();
  await page.getByRole("status").filter({hasText:"No users found"}).waitFor();
  await page.evaluate(()=>window.setFixtureAuth({ready:true,authenticated:false,user:null}));
  assert.equal(await input.isDisabled(), true);
  await page.getByRole("status").filter({hasText:"Log in"}).waitFor();
  await page.goto(`http://127.0.0.1:${server.address().port}?legacy`);
  await input.fill("bob"); await page.getByRole("option",{name:"@bob",exact:true}).click();
  assert.equal(await input.inputValue(), "bob");
  assert.deepEqual(JSON.parse(await page.getByTestId("selected").textContent()), {id:"3",username:"bob"});
  await page.getByRole("button",{name:"Clear",exact:true}).click();
  assert.equal(await input.inputValue(), "");
  console.log("PASS: mobile fit, partial/case/literal search, minimal fields, selection, keyboard, clear, empty, stale responses, database error/retry, sign-out, and legacy controlled props.");
} finally { await browser.close(); server.close(); }
