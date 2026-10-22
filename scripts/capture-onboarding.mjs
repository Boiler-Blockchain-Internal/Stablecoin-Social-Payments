// Isolated real onboarding component with mocked Privy/API, not a live login test.
// Run: npx --yes --package=playwright --package=node@24 -c "node scripts/capture-onboarding.mjs"
import { build } from "esbuild";
import { mkdir, writeFile, access } from "node:fs/promises";
import { delimiter, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

let browserModule;
for (const bin of process.env.PATH.split(delimiter)) {
  const candidate = resolve(bin, "../playwright/index.mjs");
  try { await access(candidate); browserModule = candidate; break; } catch {}
}
if (!browserModule) throw new Error("Run with the playwright package on PATH.");
const { chromium } = await import(pathToFileURL(browserModule).href);
const directory = resolve(".next/week1-ui");
await mkdir(directory, { recursive: true });
await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {UsernameOnboarding} from './src/features/auth/UsernameOnboarding'; createRoot(document.getElementById('root')).render(<UsernameOnboarding onSaved={user => { document.getElementById('result').textContent = 'Saved @' + user.username; }} />);`, resolveDir: process.cwd(), loader: "tsx" },
  bundle: true, outfile: resolve(directory, "fixture.js"), jsx: "automatic",
  plugins: [{ name: "mock-privy", setup(builder) {
    builder.onResolve({ filter: /^@privy-io\/react-auth$/ }, () => ({ path: "privy", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `export function usePrivy() { return { getAccessToken: async () => 'fixture-token' }; }` }));
  } }],
});
const css = (await import("node:fs/promises")).readFile;
// Reuse Next's generated Tailwind output for the actual component styling.
const { glob } = await import("node:fs/promises");
let styles = "";
for await (const file of glob(".next/static/**/*.css")) styles += await css(file, "utf8");
await writeFile(resolve(directory, "index.html"), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style></head><body class="bg-zinc-50 p-4 text-zinc-900"><main class="mx-auto max-w-xl space-y-4"><div id="root"></div><p id="result" role="status"></p></main><script src="fixture.js"></script></body></html>`);
const browser = await chromium.launch({ headless: true });
const fixtureServer = createServer(async (request, response) => {
  const script = request.url === "/fixture.js";
  response.setHeader("Content-Type", script ? "text/javascript" : "text/html");
  response.end(await readFile(resolve(directory, script ? "fixture.js" : "index.html")));
});
await new Promise(resolve => fixtureServer.listen(0, "127.0.0.1", resolve));
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await page.route("**/api/users/username", async route => {
    const { username } = route.request().postDataJSON();
    await route.fulfill({ status: username === "taken" ? 409 : 200, contentType: "application/json", body: JSON.stringify(username === "taken" ? { error: "That username is already taken." } : { user: { username } }) });
  });
  await page.goto(`http://127.0.0.1:${fixtureServer.address().port}`);
  await page.getByLabel("Username", { exact: true }).fill("rithvik_1");
  await page.screenshot({ path: resolve(directory, "onboarding-mobile.png"), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.getByLabel("Username", { exact: true }).fill("a b");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.getByRole("alert").filter({ hasText: "Use 3" }).waitFor();
  await page.getByLabel("Username", { exact: true }).fill("taken");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.getByRole("alert").filter({ hasText: "already taken" }).waitFor();
  await page.getByLabel("Username", { exact: true }).fill("rithvik_1");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.getByRole("status").filter({ hasText: "Saved @rithvik_1" }).waitFor();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: resolve(directory, "onboarding-desktop.png"), fullPage: true });
  console.log("PASS: isolated onboarding at 375px, validation, conflict, and success. Screenshots: .next/week1-ui/");
} finally { await browser.close(); fixtureServer.close(); }
