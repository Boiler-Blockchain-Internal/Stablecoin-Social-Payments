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
  let privyId: string;
  try {
    privyId = await requirePrivyUser(request);
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return Response.json({ error: e.message }, { status: 401 });
    }
    throw e;
  }

  const walletAddress = await getSmartWalletAddress(privyId);

  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .upsert(
      {
        privy_id: privyId,
        ...(walletAddress ? { wallet_address: walletAddress.toLowerCase() } : {}),
      },
      { onConflict: "privy_id" },
    )
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ user: data });
}
