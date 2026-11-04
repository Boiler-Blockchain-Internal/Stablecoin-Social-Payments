import { requirePrivyUser } from "@/lib/privy";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { isValidUsername, normalizeUsername, USERNAME_HELP } from "@/lib/username";
import {
  GroupError,
  errorResponse,
  getCallerUser,
  getGroup,
  isMember,
  readJsonObject,
} from "@/features/groups/server";

/**
 * POST /api/groups/[id]/members  { username }
 * Any member of the group can add another existing user by username.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const privyId = await requirePrivyUser(request);
    const group = await getGroup((await ctx.params).id);
    const caller = await getCallerUser(privyId);
    if (!(await isMember(group.id, caller.id))) throw new GroupError("Only group members can add people.", 403);

    const body = await readJsonObject(request);
    const username = typeof body.username === "string" ? normalizeUsername(body.username) : null;
    if (!isValidUsername(username)) throw new GroupError(USERNAME_HELP, 400);

    const db = getSupabaseAdmin();
    const { data: user, error } = await db.from("users").select("id, username").eq("username", username).maybeSingle();
    if (error) throw error;
    if (!user) throw new GroupError(`No user found for @${username}.`, 404);
    if (await isMember(group.id, user.id)) throw new GroupError(`@${username} is already in this group.`, 409);

    const { error: insertError } = await db.from("group_members").insert({ group_id: group.id, user_id: user.id });
    // A concurrent add of the same person hits the (group_id, user_id) primary key.
    if (insertError?.code === "23505") throw new GroupError(`@${username} is already in this group.`, 409);
    if (insertError) throw insertError;
    return Response.json({ member: { user_id: user.id, username: user.username } }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Unable to add member. Please try again.");
  }
}
