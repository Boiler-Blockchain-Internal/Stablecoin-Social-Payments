import {
  UnauthorizedError,
  getSmartWalletAddress,
  requirePrivyUser,
} from "@/lib/privy";
import { getSupabaseAdmin } from "@/lib/supabase-server";

/**
 * POST /api/users/sync
 * Called by the client after login. Upserts the users row for the verified Privy user.
 * The wallet address comes from Privy's API, not from the request body.
 *
 * Pattern for every write route: requirePrivyUser() → service-role Supabase write.
 */
export async function POST(request: Request) {
  try {
    const privyId = await requirePrivyUser(request);
    const walletAddress = await getSmartWalletAddress(privyId);
    const { data, error } = await getSupabaseAdmin().from("users").upsert(
      { privy_id: privyId, ...(walletAddress ? { wallet_address: walletAddress.toLowerCase() } : {}) },
      { onConflict: "privy_id" },
    ).select("id, privy_id, username, wallet_address, created_at").single();
    if (error) throw error;
    return Response.json({ user: data });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return Response.json({ error: e.message }, { status: 401 });
    }
    return Response.json({ error: "Unable to sync profile. Please try again." }, { status: 500 });
  }
}
