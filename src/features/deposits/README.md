# CCTP V2 deposits (testnet)

`/deposit` brings USDC from **Ethereum Sepolia** or **Arc Testnet** into the signed-in user's Privy smart wallet on
**Base Sepolia**, as the same native USDC the rest of the app uses. Only USDC moves (not ETH).

Flow:
1. The user's browser wallet (MetaMask etc.) approves and burns USDC on the source chain with
   `depositForBurn` (CCTP V2 Standard, `maxFee` 0, finality 2000, `mintRecipient` = the smart wallet).
2. `POST /api/deposits { source, burnHash }` verifies the burn receipt on the source chain (TokenMessenger
   event, source USDC, destination domain 6, recipient = the caller's smart wallet from Privy) and records it in
   `deposits`. The amount comes from the chain, never the client.
3. The same call asks Circle Iris for the attestation (404 means "not indexed yet") and reads
   `usedNonces` on the Base MessageTransmitter. It answers `burning`, `attesting`, `ready` (with message and
   attestation) or `completed`.
4. On `ready`, the browser submits `receiveMessage` from the smart wallet (gas sponsored by the paymaster), then
   calls again with `mintHash`; the deposit completes once the nonce is used.

The browser polls for ~4 minutes; Arc attests in seconds, Ethereum Sepolia takes ~15–20 minutes. Unfinished
deposits resume from the server on any device (`GET /api/deposits`) and show in Activity.

Constants (checked live on 2026-11-12): TokenMessengerV2 `0x8FE6…2DAA`, MessageTransmitterV2 `0xE737…E275`,
domains Ethereum Sepolia 0 / Arc 26 / Base Sepolia 6, USDC 6 decimals on all three. Note the public Base Sepolia RPC
caps `eth_getLogs` at 200 blocks.

Not yet: Solana, other source chains, a server-side relayer (the user's browser submits the mint).

References: https://developers.circle.com/cctp
