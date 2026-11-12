# Week 4 wallet identity regression

Confirmed P1 integration bug: WalletCard used the authenticated linked-wallet selector, but Send passed its raw SDK client address directly to `useUsdcBalance`. During an SDK/account transition the hook could read and display the previous wallet under the new account. A real-hook browser reproduction failed before the fix: it called `balanceOf` for the old address while Privy identified a different linked wallet.

The owned hook now independently checks membership in the current Privy user's linked smart wallets. It shares the same pure predicate as the existing selector; neither uses embedded EOAs. Missing/delayed metadata shows the existing unavailable state until safe identity arrives. Account/wallet-keyed results and late-response guards remain intact. No Send transaction logic, signing, paymaster, API, schema or user-facing feature is rewritten.

Unit tests verify matched case-insensitive addresses, EOA/old-wallet rejection and missing metadata. `scripts/test-week4-wallet.mjs` reproduces the direct-hook caller scenario; `scripts/test-balance-week3.mjs` covers the full selector/hook/UI with RPC failures, refresh, zero/fractions, account switches and missing wallets. Controlled RPC fixtures are not a real transaction or physical-device test. There is no UI redesign, so this regression-only PR has no changed-screen screenshot.
