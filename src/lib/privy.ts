// SERVER ONLY. Never import this from a "use client" file: it reads PRIVY_APP_SECRET.
import { PrivyClient } from "@privy-io/node";

let client: PrivyClient | null = null;

export function getPrivyServerClient(): PrivyClient {
  if (!client) {
    const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
    const appSecret = process.env.PRIVY_APP_SECRET;
    if (!appId || !appSecret) {
      throw new Error("Missing NEXT_PUBLIC_PRIVY_APP_ID or PRIVY_APP_SECRET");
    }
    client = new PrivyClient({ appId, appSecret });
  }
  return client;
}

export class UnauthorizedError extends Error {}

/**
 * Verifies the `Authorization: Bearer <privy access token>` header on an API request.
 * Returns the Privy user id (e.g. "did:privy:...") or throws UnauthorizedError.
 *
 * Every API route that writes to Supabase must call this first.
 * On the client, get the token with `const { getAccessToken } = usePrivy()`.
 */
export async function requirePrivyUser(request: Request): Promise<string> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) throw new UnauthorizedError("Missing bearer token");
  try {
    const claims = await getPrivyServerClient()
      .utils()
      .auth()
      .verifyAccessToken(token);
    return claims.user_id;
  } catch {
    throw new UnauthorizedError("Invalid Privy access token");
  }
}

/** Looks up the user's Privy smart wallet address from Privy (never trust the client for this). */
export async function getSmartWalletAddress(
  privyUserId: string,
): Promise<string | null> {
  const user = await getPrivyServerClient().users()._get(privyUserId);
  const smartWallet = user.linked_accounts.find(
    (account) => account.type === "smart_wallet",
  );
  return smartWallet && "address" in smartWallet ? smartWallet.address : null;
}
