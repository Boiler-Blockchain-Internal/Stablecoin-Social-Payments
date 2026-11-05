# History & App Shell (Weeks 1–3)

Owner: Arjun Bawa — Activity screen at `/activity`, shared bottom navigation, user/group filters, and payment receipt checks.

- `GET /api/activity` authenticates the Privy bearer token, resolves the caller's users row, and loads only transactions and requests involving that caller. It adds usernames and connects `transactions.request_id → requests.split_id → splits.group_id` for group filtering. Only pending requests appear alongside transfers to avoid duplicating paid requests.
- `POST /api/transactions/check-status` takes `{ "transactionId": "<uuid>" }`, verifies the caller is a participant, checks a Base Sepolia receipt through viem, and only confirms a successful USDC `Transfer` event matching the expected sender, recipient, and amount. It returns pending while a receipt is unavailable; reverted transactions become failed.
- The Activity screen retrieves a bearer token with `usePrivy().getAccessToken()` and sends it to both APIs. Refresh reloads history; Check pending explicitly rechecks pending on-chain transactions.
- `src/features/history/filter.ts` implements the view filters. Filtering is a UI convenience; the API does its own authorization.
- The shared Send function in this repository snapshot still returns fake transaction hashes; real end-to-end transfers cannot be verified until the Send owner's real on-chain implementation is merged.
- The Send navigation points to a placeholder `/send` route linking to the existing `/test-send` developer screen. The Send owner should replace the placeholder with their finished `/send` screen.
- **Security follow-up for the lead:** the initial migration's public SELECT RLS policies make transactions and requests readable to anonymous clients. Revoke those policies/grants in a separate coordinated migration. The new History endpoints deliberately read through authenticated server APIs but do not fix existing public table exposure.
