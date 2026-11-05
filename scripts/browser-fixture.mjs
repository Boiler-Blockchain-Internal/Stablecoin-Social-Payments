// Shared test-only harness. Real components, explicitly mocked external services.
import { build } from "esbuild";
import { access, glob, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { delimiter, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function withBrowserFixture(name, source, stubs, run) {
  let modulePath;
  for (const bin of process.env.PATH.split(delimiter)) {
    const candidate = resolve(bin, "../playwright/index.mjs");
    try { await access(candidate); modulePath = candidate; break; } catch {}
  }
  if (!modulePath) throw new Error("Run with Playwright on PATH; install Chromium first.");
  const { chromium } = await import(pathToFileURL(modulePath).href);
  const directory = resolve(`.next/${name}-fixture`);
  await mkdir(directory, { recursive: true });
  await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, jsx: "automatic",
    define: { "process.env": JSON.stringify({ NODE_ENV: "development" }) }, outfile: resolve(directory, "fixture.js"),
    plugins: [{ name: "fixture-services", setup(builder) {
      builder.onResolve({ filter: /.*/ }, ({ path }) => Object.hasOwn(stubs, path) ? { path, namespace: "fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: stubs[path], resolveDir: process.cwd() }));
    } }],
  });
  let styles = "";
  for await (const file of glob(".next/static/**/*.css")) styles += await readFile(file, "utf8");
  await writeFile(resolve(directory, "index.html"), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style></head><body class="bg-zinc-50 text-zinc-900"><div id="root"></div><script src="/fixture.js"></script></body></html>`);
  const server = createServer(async (request, response) => {
    const script = request.url === "/fixture.js";
    response.setHeader("Content-Type", script ? "text/javascript" : "text/html");
    response.end(await readFile(resolve(directory, script ? "fixture.js" : "index.html")));
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    page.on("pageerror", error => console.error("Fixture browser error:", error.message));
    await run({ page, browser, origin: `http://127.0.0.1:${server.address().port}`, directory });
  } finally { await browser.close(); server.close(); }
}

export const authFixture = `import {useSyncExternalStore} from 'react';
let state={ready:true,authenticated:true,user:{id:new URLSearchParams(location.search).get('account')??'new'}};
const subscribe=fn=>{window.addEventListener('auth',fn);return()=>window.removeEventListener('auth',fn);};
window.setFixtureAuth=next=>{state=next;window.dispatchEvent(new Event('auth'));};
const getAccessToken=async()=>state.authenticated?state.user?.id:null;
export function usePrivy(){return {...useSyncExternalStore(subscribe,()=>state),getAccessToken,login:()=>{},logout:async()=>{window.setFixtureAuth({ready:true,authenticated:false,user:null});}};}`;
