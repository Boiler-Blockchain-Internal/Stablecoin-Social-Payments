import type { ActivityFilter, ActivityItem } from "./types";

export function filterActivity(
  items: ActivityItem[],
  userId: string,
  filter: ActivityFilter,
  personId: string,
  groupId: string,
): ActivityItem[] {
  return items.filter((item) => {
    // A deposit comes from the user's own wallet on another network, not from another person.
    const from = item.kind === "transaction" ? item.fromUser : item.kind === "request" ? item.payerId : null;
    const to = item.kind === "request" ? item.requesterId : item.toUser;
    if (filter === "sent" && from !== userId) return false;
    if (filter === "received" && to !== userId) return false;
    if (filter === "pending" && item.status !== "pending") return false;
    if (personId && from !== personId && to !== personId) return false;
    if (groupId && item.groupId !== groupId) return false;
    return true;
  });
}
