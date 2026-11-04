export type PaymentRequest = {
  id: string;
  requester_id: string;
  payer_id: string;
  amount: string;
  note: string | null;
  status: "pending" | "paid" | "declined";
  split_id: string | null;
  created_at: string;
};

export async function createRequest(
  toUsername: string,
  amount: string,
  note?: string,
  splitId?: string,
  authToken?: string,
): Promise<PaymentRequest> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const res = await fetch("/api/requests", {
    method: "POST",
    headers,
    body: JSON.stringify({ toUsername, amount, note, splitId }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Failed to create request.");
  return body.request;
}
