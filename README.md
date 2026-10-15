# StablePay

A Venmo-style app for sending and requesting USDC with friends. Users log in with email or Google (Privy), get a smart wallet with sponsored gas, and pay each other in USDC on the **Base Sepolia testnet**. Payments, requests, groups, and splits are stored in Supabase.

**Stack:** Next.js (App Router, TypeScript) · Tailwind · Privy (auth + smart wallets) · viem · Supabase · Base Sepolia

## Run locally

```bash
git clone https://github.com/Boiler-Blockchain-Internal/Stablecoin-Social-Payments.git
cd Stablecoin-Social-Payments
npm install
cp .env.example .env.local   # then get the real values from the lead
npm run dev                  # http://localhost:3000
```

Never commit `.env.local`.

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
2. Open a PR to `main`.
3. Merge once CI (lint, typecheck, build) passes. Don't push directly to `main`.

## Checking your setup

`npx tsx scripts/verify-setup.ts` checks env vars, Supabase, Privy, the chain, and the build. The database checks need Supabase CLI access, so they only pass for the lead.
