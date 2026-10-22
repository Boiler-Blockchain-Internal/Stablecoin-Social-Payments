/** Read-only setup verification. Never prints environment values or user data. */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { getPrivyServerClient } from "../src/lib/privy";
import { createPublicClient, erc20Abi, http, type Address } from "viem";
import { baseSepolia } from "viem/chains";

async function main() {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (match) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  const names = [...readFileSync(".env.example", "utf8").matchAll(/^([A-Z_]+)=/gm)].map((m) => m[1]);
  const missing = names.filter((name) => !process.env[name]);
  console.log(missing.length ? `Missing environment names: ${missing.join(", ")}` : `PASS: all ${names.length} environment names populated (values hidden)`);
  if (missing.length) { process.exitCode = 1; return; }
  async function check(name: string, action: () => Promise<void>) {
    try { await action(); console.log(`PASS: ${name}`); }
    catch { console.log(`FAIL: ${name} (details withheld to protect credentials and user data)`); process.exitCode = 1; }
  }
  await check("Supabase anon can read expected users columns", async () => {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { error } = await db.from("users").select("id,privy_id,username,wallet_address,created_at", { head: true }).limit(1);
    if (error) throw error;
  });
  await check("Supabase service role can read users", async () => {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { error } = await db.from("users").select("id", { head: true }).limit(1);
    if (error) throw error;
  });
  await check("Privy server credentials accepted (not an interactive login)", async () => {
    await getPrivyServerClient().users().list({ limit: 1 });
  });
  const rpc = createPublicClient({ chain: baseSepolia, transport: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL, { timeout: 15000, retryCount: 0 }) });
  await check("RPC reports Base Sepolia chain 84532", async () => {
    if (await rpc.getChainId() !== 84532) throw new Error("Wrong chain");
  });
  await check("Configured USDC contract has 6 decimals", async () => {
    if (await rpc.readContract({ address: process.env.NEXT_PUBLIC_USDC_ADDRESS as Address, abi: erc20Abi, functionName: "decimals" }) !== 6) throw new Error("Wrong decimals");
  });
}
main().catch(() => { console.error("Setup verification could not run; check local configuration."); process.exitCode = 1; });
