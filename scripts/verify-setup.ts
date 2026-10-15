/**
 * Checks that the whole stack is wired up. Run with: npx tsx scripts/verify-setup.ts
 * Flags: --skip-build (skip lint/tsc/build), --skip-github
 *
 * The realtime check uses `supabase db query --linked` (needs `npx supabase login` + link),
 * and some GitHub checks need repo admin, so a few checks only pass for the lead.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createPublicClient, erc20Abi, http, type Address } from "viem";
import { baseSepolia } from "viem/chains";

const REPO = "Boiler-Blockchain-Internal/Stablecoin-Social-Payments";
const TABLES = ["users", "transactions", "requests", "groups", "group_members", "splits"];
const args = new Set(process.argv.slice(2));

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];

async function check(name: string, fn: () => Promise<string> | string) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
  } catch (e) {
    results.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) });
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function sh(cmd: string): string {
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function parseEnvFile(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

async function main() {
  // 1. Env ------------------------------------------------------------------
  assert(existsSync(".env.local"), ".env.local not found (copy .env.example)");
  const example = parseEnvFile(".env.example");
  const env = parseEnvFile(".env.local");

  await check("1. .env.local has every key in .env.example", () => {
    const missing = Object.keys(example).filter((k) => !env[k]);
    assert(missing.length === 0, `missing/empty: ${missing.join(", ")}`);
    return `${Object.keys(example).length} keys set`;
  });

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = createClient(url, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // 2. Supabase ---------------------------------------------------------------
  await check("2a. Supabase anon key can SELECT users", async () => {
    const { error, count } = await anon.from("users").select("id", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    return `${count ?? 0} rows visible`;
  });

  await check("2b. Supabase anon key cannot INSERT (RLS)", async () => {
    const { error } = await anon.from("users").insert({ privy_id: `verify-anon-${Date.now()}` });
    assert(error, "anon insert succeeded; RLS is not blocking writes");
    return `blocked (${error.code})`;
  });

  await check("2c. Service role can INSERT + DELETE a users row", async () => {
    const privyId = `verify-setup-${Date.now()}`;
    const ins = await admin.from("users").insert({ privy_id: privyId }).select("id").single();
    if (ins.error) throw new Error(`insert: ${ins.error.message}`);
    const del = await admin.from("users").delete().eq("id", ins.data.id).select("id");
    if (del.error) throw new Error(`delete: ${del.error.message}`);
    assert(del.data.length === 1, "delete removed 0 rows");
    return "inserted and deleted test row";
  });

  await check("2d. All 6 tables exist", async () => {
    const missing: string[] = [];
    for (const t of TABLES) {
      const { error } = await admin.from(t).select("*", { head: true, count: "exact" });
      if (error) missing.push(`${t} (${error.message})`);
    }
    assert(missing.length === 0, `missing: ${missing.join(", ")}`);
    return TABLES.join(", ");
  });

  // 3. Realtime ---------------------------------------------------------------
  await check("3. requests + transactions in supabase_realtime", () => {
    const out = sh(
      `npx supabase db query --linked "select tablename from pg_publication_tables where pubname = 'supabase_realtime'"`,
    );
    const missing = ["requests", "transactions"].filter(
      (t) => !new RegExp(`"tablename":\\s*"${t}"`).test(out),
    );
    assert(missing.length === 0, `not in publication: ${missing.join(", ")}`);
    return "both published";
  });

  // 4. Privy ------------------------------------------------------------------
  await check("4. Privy app ID + secret accepted by REST API", async () => {
    const appId = env.NEXT_PUBLIC_PRIVY_APP_ID;
    const res = await fetch("https://api.privy.io/v1/users?limit=1", {
      headers: {
        Authorization: `Basic ${Buffer.from(`${appId}:${env.PRIVY_APP_SECRET}`).toString("base64")}`,
        "privy-app-id": appId,
      },
    });
    assert(res.ok, `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return `HTTP ${res.status}`;
  });

  // 5. Chain ------------------------------------------------------------------
  const client = createPublicClient({ chain: baseSepolia, transport: http(env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL) });

  await check("5a. RPC chain id is 84532", async () => {
    const id = await client.getChainId();
    assert(id === 84532, `got ${id}`);
    return String(id);
  });

  await check("5b. USDC contract decimals is 6", async () => {
    const decimals = await client.readContract({
      address: env.NEXT_PUBLIC_USDC_ADDRESS as Address,
      abi: erc20Abi,
      functionName: "decimals",
    });
    assert(decimals === 6, `got ${decimals}`);
    return String(decimals);
  });

  // 6. Lint / tsc / build -------------------------------------------------------
  if (!args.has("--skip-build")) {
    for (const [name, cmd] of [
      ["6a. npm run lint", "npm run lint"],
      ["6b. tsc --noEmit", "npx tsc --noEmit"],
      ["6c. npm run build", "npm run build"],
    ] as const) {
      await check(name, () => {
        try {
          sh(cmd);
        } catch (e) {
          const err = e as { stdout?: string; stderr?: string };
          throw new Error(`${err.stdout ?? ""}${err.stderr ?? ""}`.trim().split("\n").slice(-8).join("\n"));
        }
        return "passed";
      });
    }
  }

  // 7. GitHub -------------------------------------------------------------------
  if (!args.has("--skip-github")) {
    await check("7a. Repo visibility", () => {
      const { visibility } = JSON.parse(sh(`gh repo view ${REPO} --json visibility`));
      return visibility;
    });

    await check("7b. Latest CI run on main passed", () => {
      const [run] = JSON.parse(
        sh(`gh run list -R ${REPO} --branch main --workflow ci.yml --limit 1 --json conclusion,status,headSha`),
      );
      assert(run, "no CI runs on main");
      assert(run.conclusion === "success", `status=${run.status} conclusion=${run.conclusion}`);
      return `success @ ${run.headSha.slice(0, 7)}`;
    });

    await check("7c. Collaborators", () => {
      const accepted: { login: string; role_name: string }[] = JSON.parse(
        sh(`gh api repos/${REPO}/collaborators --paginate`),
      );
      const pending: { invitee: { login: string } | null; email?: string }[] = JSON.parse(
        sh(`gh api repos/${REPO}/invitations --paginate`),
      );
      const a = accepted.map((c) => `${c.login} (${c.role_name})`).join(", ") || "none";
      const p = pending.map((i) => i.invitee?.login ?? i.email ?? "?").join(", ") || "none";
      return `accepted: ${a} | pending: ${p}`;
    });
  }

  // Report -----------------------------------------------------------------------
  console.log("");
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}`);
    console.log(`      ${r.detail.split("\n").join("\n      ")}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
