import { requirePrivyUser } from "@/lib/privy";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import {
  errorResponse,
  getCallerUser,
  parseGroupName,
  readJsonObject,
  resolveMembers,
} from "@/features/groups/server";

/**
 * POST /api/groups  { name, members: string[] }
 * Creates a group owned by the verified caller, with the caller and the listed usernames as members.
 */
export async function POST(request: Request) {
  try {
    const privyId = await requirePrivyUser(request);
    const body = await readJsonObject(request);
    const name = parseGroupName(body.name);
    const caller = await getCallerUser(privyId);
    const memberIds = await resolveMembers(body.members ?? [], caller);

    const db = getSupabaseAdmin();
    const { data: group, error } = await db.from("groups")
      .insert({ name, created_by: caller.id })
      .select("id, name, created_by, created_at").single();
    if (error) throw error;

    const rows = [caller.id, ...memberIds].map((user_id) => ({ group_id: group.id, user_id }));
    const { error: membersError } = await db.from("group_members").insert(rows);
    if (membersError) {
      // The REST API has no transactions: remove the group so no memberless group is left behind.
      await db.from("groups").delete().eq("id", group.id);
      throw membersError;
    }
    return Response.json({ group }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Unable to create group. Please try again.");
  }
}
