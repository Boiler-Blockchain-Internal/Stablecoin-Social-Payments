# Auth & Profiles: club testing and November 12 demo

Use this alongside the existing [profile](profile-page.md), [UserPicker](user-picker.md), and Week 3 [onboarding](week3-onboarding.md), [balance](week3-balance.md), and [faucet](week3-faucet.md) instructions. Do not use the old local `/preview` page: it was a temporary branch-only directory and is removed from the Week 4 checkout. Current main has the team's real navigation, `/send`, `/requests`, `/groups`, `/activity` and `/deposit` screens (deposits are outside Auth's scope).

## Organizer setup (manual)

1. Ask the lead to review the Week 4 fix PRs and prepare a build containing them for the November 12 demo. Do not merge or deploy without the team's approval. The current workflow skips previews for non-crh78 authors; use a lead-authorized deployment or localhost.
2. Use Node 24/npm 11.12+, `npm ci`, and the existing private `.env.local`. Start with `npx --yes --package=node@24 --package=npm@11.12.0 npm run dev`. Never share the environment file.
3. Confirm the lead applied all committed Supabase migrations and configured Privy allowed origins, Google login, Base Sepolia smart wallets and the existing paymaster. Do not change shared schema in the dashboard.
4. Recruit 5–10 actual club members. Give each an anonymous tester ID (C01, C02, ...), a test URL, and the checklist below. Assign at least one email and one Google sign-in, iPhone Safari and Android Chrome where available, and two browser profiles/accounts for account-switch and peer tests. Record actual participation only.
5. Ask testers to use only test USDC, their own sign-in codes, and public wallet addresses. Do not collect emails, OTPs, access tokens, private keys or environment values in feedback/screenshots. Get permission before saving a screen recording.

## Tester checklist (10–15 minutes)

Record Pass / Fail / Blocked / Not tested per item, plus the build/commit, device, OS and browser. Physical-phone and emulated-viewport results must be labelled separately.

| ID | Task | Expected result |
| --- | --- | --- |
| A1 | Sign in with your assigned email or Google method | Login completes; no wrong-account information flashes |
| A2 | For a new account, choose a username | 3–20 letters/numbers/underscores; saved lowercase; invalid/taken names are rejected clearly |
| A3 | Refresh during onboarding, then save; later log out/in | No loop, duplicate account or repeated onboarding; username persists |
| P1 | Open Profile and refresh it | Your username and join date are correct |
| P2 | Log out, sign in as a different account | Old profile, search and wallet data disappear; new account is correct |
| U1 | In Send, search a peer's partial/mixed-case username and select it | Correct peer selected; no email or wallet shown in search results |
| U2 | Clear/replace selection, try an unknown name and type rapidly | Clear works, empty state is useful, old results never replace the newer query |
| U3 | On a phone, tap a result and Clear; with keyboard, select and clear using Enter | No unintended form submission or group-member addition |
| U4 | Repeat peer selection in Requests and Groups | The intended username reaches each form; imports/callback behavior stays consistent |
| W1 | Compare wallet address with the existing Send smart wallet | Same smart wallet; no embedded signer or previous account's address |
| W2 | Observe zero/funded balance and click Refresh | Base Sepolia USDC loads with accurate fractions; refresh shows changes |
| F1 | In Get test USDC, keep Base Sepolia selected, copy the address and open Circle faucet | Correct address copied; official Circle page opens a new tab (Arc/Ethereum Sepolia go through Deposit instead) |
| F2 | On Circle select USDC and Base Sepolia, paste address and submit manually | Circle's checks/limits are respected; return and refresh after confirmed funding |
| E1 | Temporarily block a profile/search request in browser tools, then recover | Clear error/retry; buttons recover; no stale save/redirect after logout |
| M1 | Check relevant screens on your physical phone | Inputs, results, address, balance and navigation fit and remain usable |

Optional coordinated payment test: with two funded test accounts, send a small amount (e.g. 0.10 USDC) through the existing Send UI, wait for verified confirmation, refresh both balances and inspect Activity. Coordinate real-transfer/recovery issues with the Send/History owners; do not double-pay a pending intent or manually mark it confirmed. Request and group flows may create shared test records: agree on cleanup with their owners.

## Short survey and bug capture

After the checklist, ask: (1) How easy was sign-in/username setup, 1–5? (2) Could you find and select the right peer? (3) Were wallet/balance/faucet instructions clear? (4) What was most confusing? (5) Any device/browser problem? (6) Would you feel comfortable repeating the demo steps unaided?

Copy actual bugs into [week4-feedback.csv](week4-feedback.csv), one row per finding. It starts with a header only: no survey responses or completed testers are fabricated. Include the scenario ID, expected/actual behavior, exact reproduction, device/browser, evidence and owner. Keep a separate attendance/consent list outside the repository if needed; do not put personal contact details here.

Priority: P0 = wrong-user writes/identity, exposed credentials, wrong-wallet transfer or false financial success (stop that flow); P1 = login/onboarding blocked, account leakage or permanent stuck state; P2 = incorrect selection/keyboard/touch/layout/error recovery; P3 = minor copy/spacing. Fix confirmed Auth-owned issues first. Send/Requests/Groups/History-only issues need reproduction and handoff, not an unrelated rewrite.

## Two-minute Auth & Profiles demo

1. Sign in with a prepared account; show username persistence (use a fresh account beforehand to demonstrate onboarding separately).
2. Open Profile; explain that Privy identity is verified server-side before Supabase writes.
3. Search/select a prepared peer in Send or Groups; demonstrate keyboard/touch selection and Clear.
4. Show the smart-wallet address and funded Base Sepolia balance. Copy the public address and open Circle; explicitly select Base Sepolia. Avoid relying on a fresh faucet request during the demo because of external checks/limits.
5. Refresh the balance, log out, and log back in. Explain Weeks 1–3: identity/onboarding, shared search/profile, then reliable wallet/faucet access. Week 4 adds cancellation/timeouts, keyboard/touch fixes and evidence-backed testing.

Prepare: two verified test accounts, known peer usernames, at least one funded wallet, a working allowed origin and network, and evidence for Google/email and physical phones. No claim of full demo readiness until the manual checklist and real testers are complete.
