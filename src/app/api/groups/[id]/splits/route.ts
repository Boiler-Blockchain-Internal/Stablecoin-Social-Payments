import { fromUsdcUnits, toUsdcUnits } from "@/lib/chain";
import { requirePrivyUser } from "@/lib/privy";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { AMOUNT_MAX, NOTE_MAX, parseAmount } from "@/features/requests/validation";
import {
  GroupError,
  errorResponse,
  getCallerUser,
  getGroup,
  isMember,
  parseBillShares,
  readJsonObject,
} from "@/features/groups/server";

/**
 * POST /api/groups/[id]/splits  { description, total, mode: "even" | "custom", shares?: { userId, amount }[] }
 * The caller paid the bill, so every other member with a share gets a pending request to the caller.
 * The total includes the caller's own share, which needs no request.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const privyId = await requirePrivyUser(request);
    const group = await getGroup((await ctx.params).id);
    const caller = await getCallerUser(privyId);
    if (!(await isMember(group.id, caller.id))) throw new GroupError("Only group members can add a bill.", 403);

    const body = await readJsonObject(request);
    const description = typeof body.description === "string" ? body.description.trim() : "";
    if (!description) throw new GroupError("Say what the bill is for.", 400);
    if (description.length > NOTE_MAX) throw new GroupError(`Descriptions can be at most ${NOTE_MAX} characters.`, 400);
    const total = parseAmount(body.total);
    if (!total) throw new GroupError(`Enter a total between 0 and ${AMOUNT_MAX} USDC, with at most 6 decimals.`, 400);

    const db = getSupabaseAdmin();
    const { data: members, error: membersError } = await db.from("group_members").select("user_id").eq("group_id", group.id);
    if (membersError) throw membersError;
    const memberIds = (members ?? []).map((member: { user_id: string }) => member.user_id);

    const owed = parseBillShares(body, toUsdcUnits(total), memberIds).filter((share) => share.userId !== caller.id);
    if (owed.length === 0) throw new GroupError("Someone else needs to owe part of this bill.", 400);

    const { data: split, error: splitError } = await db.from("splits")
      .insert({ group_id: group.id, created_by: caller.id, description, total })
      .select("id, group_id, created_by, description, total, created_at").single();
    if (splitError) throw splitError;

    const rows = owed.map((share) => ({
      requester_id: caller.id,
      payer_id: share.userId,
      amount: fromUsdcUnits(share.units),
      note: description,
      status: "pending",
      split_id: split.id,
    }));
    const { data: requests, error: requestsError } = await db.from("requests")
      .insert(rows).select("id, requester_id, payer_id, amount, note, status, split_id, created_at");
    if (requestsError) {
      // The REST API has no transactions, but this one insert is all-or-nothing: remove the empty split.
      await db.from("splits").delete().eq("id", split.id);
      throw requestsError;
    }
    return Response.json({ split, requests }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Unable to add bill. Please try again.");
  }
}
