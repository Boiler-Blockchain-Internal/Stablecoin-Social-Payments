import { requirePrivyUser } from "@/lib/privy";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { GroupError, errorResponse, getCallerUser, getGroup, isMember } from "@/features/groups/server";
import { isUuid } from "@/features/groups/validation";

/**
 * DELETE /api/groups/[id]/members/[userId]
 * The creator can remove anyone else; any member can remove themselves (leave). The creator stays.
 */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string; userId: string }> }) {
  try {
    const privyId = await requirePrivyUser(request);
    const { id, userId } = await ctx.params;
    const group = await getGroup(id);
    if (!isUuid(userId)) throw new GroupError("That member isn't valid.", 400);
    const caller = await getCallerUser(privyId);

    if (!(await isMember(group.id, caller.id))) throw new GroupError("Only group members can remove people.", 403);
    if (userId === group.created_by) throw new GroupError("The group creator can't be removed.", 403);
    if (userId !== caller.id && caller.id !== group.created_by) {
      throw new GroupError("Only the group creator can remove other members.", 403);
    }
    if (!(await isMember(group.id, userId))) throw new GroupError("That person isn't in this group.", 404);

    const { error } = await getSupabaseAdmin()
      .from("group_members").delete().eq("group_id", group.id).eq("user_id", userId);
    if (error) throw error;
    return Response.json({ removed: userId });
  } catch (error) {
    return errorResponse(error, "Unable to remove member. Please try again.");
  }
}
