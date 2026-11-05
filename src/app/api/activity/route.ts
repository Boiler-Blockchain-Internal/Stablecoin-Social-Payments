import { requirePrivyUser } from "@/lib/privy";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { errorResponse, getCallerUser } from "@/features/requests/server";
import type { ActivityItem, HistoryGroup, HistoryPerson } from "@/features/history/types";

const TX_COLUMNS = "id, from_user, to_user, amount, note, status, tx_hash, request_id, created_at";
const REQUEST_COLUMNS = "id, requester_id, payer_id, amount, note, status, split_id, created_at";

export async function GET(request: Request) {
  try {
    const caller = await getCallerUser(await requirePrivyUser(request));
    const db = getSupabaseAdmin();
    const [sent, received, requested, owed, memberships] = await Promise.all([
      db.from("transactions").select(TX_COLUMNS).eq("from_user", caller.id),
      db.from("transactions").select(TX_COLUMNS).eq("to_user", caller.id),
      db.from("requests").select(REQUEST_COLUMNS).eq("requester_id", caller.id),
      db.from("requests").select(REQUEST_COLUMNS).eq("payer_id", caller.id),
      db.from("group_members").select("group_id").eq("user_id", caller.id),
    ]);
    for (const res of [sent, received, requested, owed, memberships]) if (res.error) throw res.error;

    const transactions = [...new Map([...(sent.data ?? []), ...(received.data ?? [])].map((t) => [t.id, t])).values()];
    const requests = [...new Map([...(requested.data ?? []), ...(owed.data ?? [])].map((r) => [r.id, r])).values()];
    const requestById = new Map(requests.map((r) => [r.id as string, r]));
    const missingRequestIds = [...new Set(transactions.map((t) => t.request_id as string | null)
      .filter((id): id is string => Boolean(id) && !requestById.has(id as string)))];
    if (missingRequestIds.length) {
      const extra = await db.from("requests").select(REQUEST_COLUMNS).in("id", missingRequestIds);
      if (extra.error) throw extra.error;
      for (const r of extra.data ?? []) requestById.set(r.id, r);
    }

    const splitIds = [...new Set([...requestById.values()].map((r) => r.split_id as string | null)
      .filter((id): id is string => Boolean(id)))];
    const splitGroups = new Map<string, string>();
    if (splitIds.length) {
      const splits = await db.from("splits").select("id, group_id").in("id", splitIds);
      if (splits.error) throw splits.error;
      for (const s of splits.data ?? []) if (s.group_id) splitGroups.set(s.id, s.group_id);
    }

    const memberGroupIds = [...new Set((memberships.data ?? []).map((m) => m.group_id as string))];
    let groups: HistoryGroup[] = [];
    if (memberGroupIds.length) {
      const result = await db.from("groups").select("id, name").in("id", memberGroupIds);
      if (result.error) throw result.error;
      groups = result.data ?? [];
    }
    const allowedGroups = new Set(memberGroupIds);
    const relatedGroup = (splitId: string | null): string | null => {
      const groupId = splitId ? splitGroups.get(splitId) : null;
      return groupId && allowedGroups.has(groupId) ? groupId : null;
    };

    const userIds = [...new Set([...transactions.flatMap((t) => [t.from_user, t.to_user]),
      ...requests.flatMap((r) => [r.requester_id, r.payer_id])].filter((id): id is string => typeof id === "string"))];
    const usernames = new Map<string, string | null>();
    if (userIds.length) {
      const result = await db.from("users").select("id, username").in("id", userIds);
      if (result.error) throw result.error;
      for (const u of result.data ?? []) usernames.set(u.id, u.username);
    }

    const items: ActivityItem[] = [
      ...transactions.map((t) => {
        const requestRow = t.request_id ? requestById.get(t.request_id) : null;
        return {
          kind: "transaction" as const, id: t.id, fromUser: t.from_user, toUser: t.to_user,
          fromUsername: usernames.get(t.from_user) ?? null, toUsername: usernames.get(t.to_user) ?? null,
          amount: String(t.amount), note: t.note, status: t.status, txHash: t.tx_hash,
          requestId: t.request_id, groupId: relatedGroup(requestRow?.split_id ?? null), createdAt: t.created_at,
        };
      }),
      ...requests.filter((r) => r.status === "pending").map((r) => ({
        kind: "request" as const, id: r.id, requesterId: r.requester_id, payerId: r.payer_id,
        requesterUsername: usernames.get(r.requester_id) ?? null, payerUsername: usernames.get(r.payer_id) ?? null,
        amount: String(r.amount), note: r.note, status: "pending" as const,
        groupId: relatedGroup(r.split_id), createdAt: r.created_at,
      })),
    ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    const people: HistoryPerson[] = [...userIds].filter((id) => id !== caller.id && usernames.get(id))
      .map((id) => ({ id, username: usernames.get(id)! })).sort((a, b) => a.username.localeCompare(b.username));
    return Response.json({ items, people, groups }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return errorResponse(e, "Unable to fetch activity.");
  }
}
