# CCTP V2 deposits — testnet-only first pass

This branch adds `/deposit` and a Circle sandbox attestation endpoint. It does **not** add cross-chain sending, Solana, Supabase-backed deposit history, or a background relayer. It does not modify normal send or transaction tables.

Current source wallets: injected EVM browser wallet on Ethereum Sepolia or Arc Testnet. The recipient is always the signed-in Privy smart wallet on Base Sepolia. Source-chain gas is not sponsored. Arc uses USDC for gas, so keep enough for fees.

Sequence: source wallet connects → verify USDC balance and allowance → approve if necessary → CCTP V2 Standard burn → store burn hash locally → verify source receipt event → check Circle Iris sandbox attestation → invoke `receiveMessage` using Base Sepolia Privy smart wallet → verify the mint receipt. The browser retains a pending burn hash on refresh; the user can click **Check / complete deposit** later.

**Do not test with mainnet funds.** Standard Ethereum finality can take many minutes. Use small testnet amounts first. The project has no source-wallet onboarding or Solana wallet integration yet.

## Important before release

- Live end-to-end tests on both networks, especially Arc native USDC allowance/approval, have NOT yet been performed.
- Confirm the CCTP source and destination contracts, supported routes, and Circle Iris availability in the official docs on test day.
- The demo's localStorage recovery is per browser, not durable across devices. Add server-side deposit persistence, idempotency, recipient verification and recovery monitoring before production.
- If a wallet submits a burn without returning a hash to the browser, the user must recover it from their source wallet activity. Never retry the burn blindly.
- A source burn can succeed while the destination mint has not yet happened. Don't consider the deposit successful until the destination receipt is verified.
- The current API proxy is authenticated but has no extra rate limits; add rate limiting for deployed use.

Official references: https://developers.circle.com/cctp and https://github.com/circlefin/circle-cctp-crosschain-transfer
