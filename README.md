# StablePay

A Venmo-style app for sending and requesting USDC with friends. Users log in with email or Google (Privy), get a smart wallet with sponsored gas, and pay each other in USDC on the **Base Sepolia testnet**. Payments, requests, groups, and splits are stored in Supabase.

**Stack:** Next.js (App Router, TypeScript) · Tailwind · Privy (auth + smart wallets) · viem · Supabase · Base Sepolia

## Run locally

Clone the repo directly. **Don't fork it**: you already have push access, and PRs from forks don't get repo secrets.

You need Node 20.17+ (Node 24 recommended) and **npm 11.12+**, the version CI uses. Older npm fails `npm ci` with a `Missing: ... from lock file` error. If you hit that error, upgrade npm and re-run.

```bash
npm install -g npm@11        # once; then check `npm --version` is 11.12 or higher
git clone https://github.com/Boiler-Blockchain-Internal/Stablecoin-Social-Payments.git
cd Stablecoin-Social-Payments
npm install
# Save the env file the lead sent you (stablecoin-team.env) as .env.local in the repo root:
cp ~/Downloads/stablecoin-team.env .env.local
npm run dev                  # http://localhost:3000
```

Log in with email at http://localhost:3000 and you should see your smart wallet address and a USDC balance.

- Never commit `.env.local` (it's gitignored). `.env.example` lists the keys with no values.
- If `npm install` changes `package-lock.json` and you didn't add a package, don't commit it: run `git checkout package-lock.json`. A churned lockfile makes CI's `npm ci` fail.

## Where things go

| Path | What |
| --- | --- |
| `src/app/` | Pages and API routes (`src/app/api/...`) |
| `src/components/` | Shared UI (`Shell`) |
| `src/features/{auth,send,requests,groups,history}` | One folder per feature owner |
| `src/lib/` | `chain.ts` (Base Sepolia + USDC), `privy.ts` (server auth), `supabase-browser.ts`, `supabase-server.ts` |
| `supabase/migrations/` | Database schema (change it with a new migration, never by hand in the dashboard) |

**Rules:**
- The user's address is always their **smart wallet** address. Send transactions through the Privy smart wallet client so gas is sponsored.
- The browser only **reads** from Supabase (anon key).
- Every **write** goes through an API route that calls `requirePrivyUser()` and then uses `getSupabaseAdmin()`. See `src/app/api/users/sync/route.ts` for the pattern.

## Branches and PRs

1. Branch from `main` as `yourname/feature` (e.g. `alex/send-form`).
2. Push it and open a PR to `main`.
3. Merge once CI (lint, typecheck, build) passes. Don't push directly to `main`.

PRs opened by crh78 also get a **Vercel preview** deployment, and a bot comments its URL on the PR. Previews are behind Vercel login.
Other people's PRs skip the preview: the Vercel team is on the Hobby plan, which blocks deploys of commits by non-members. CI still runs on every PR.
**Privy login only works on `http://localhost:3000` and production** (https://stablecoin-social-payments.vercel.app), not on preview URLs, so test anything that needs login locally.
Merging to `main` deploys to production automatically. For the same Hobby reason, only crh78 should merge, using **Create a merge commit** (not squash or rebase).

## Checking your setup

`npx tsx scripts/verify-setup.ts` checks env vars, Supabase, Privy, the chain, and the build. The database checks need Supabase CLI access, so they only pass for the lead.

## Contributors

- Rithvik Reddy Siddenki - Auth & Profiles
- Eshwar Bejugam - Send
