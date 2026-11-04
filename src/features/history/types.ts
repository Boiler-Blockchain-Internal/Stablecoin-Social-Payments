export type TransactionStatus = "pending" | "confirmed" | "failed";
export type RequestStatus = "pending" | "paid" | "declined";

export type HistoryTransaction = {
  kind: "transaction";
  id: string;
  fromUser: string;
  toUser: string;
  fromUsername: string | null;
  toUsername: string | null;
  amount: string;
  note: string | null;
  status: TransactionStatus;
  txHash: string | null;
  requestId: string | null;
  groupId: string | null;
  createdAt: string;
};

export type HistoryRequest = {
  kind: "request";
  id: string;
  requesterId: string;
  payerId: string;
  requesterUsername: string | null;
  payerUsername: string | null;
  amount: string;
  note: string | null;
  status: RequestStatus;
  groupId: string | null;
  createdAt: string;
};

export type ActivityItem = HistoryTransaction | HistoryRequest;
export type ActivityFilter = "all" | "sent" | "received" | "pending";
export type HistoryGroup = { id: string; name: string };
export type HistoryPerson = { id: string; username: string };
export type ActivityResponse = { items: ActivityItem[]; groups: HistoryGroup[]; people: HistoryPerson[] };
