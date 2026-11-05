import type { ActivityFilter, ActivityItem } from "./types";

export function filterActivity(
  items: ActivityItem[],
  userId: string,
  filter: ActivityFilter,
  personId: string,
  groupId: string,
): ActivityItem[] {
  return items.filter((item) => {
    const from = item.kind === "transaction" ? item.fromUser : item.payerId;
    const to = item.kind === "transaction" ? item.toUser : item.requesterId;
    if (filter === "sent" && from !== userId) return false;
    if (filter === "received" && to !== userId) return false;
    if (filter === "pending" && item.status !== "pending") return false;
    if (personId && from !== personId && to !== personId) return false;
    if (groupId && item.groupId !== groupId) return false;
    return true;
  });
}
