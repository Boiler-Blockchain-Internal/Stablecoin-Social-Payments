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

/**
 * Ask another user (by username) to pay you.
 *
 * Agreed shape; build against this signature.
 *
 * TODO (requests owner):
 * - POST to an API route (e.g. /api/requests) with `Authorization: Bearer <getAccessToken()>`.
 *   The route calls requirePrivyUser(), resolves toUsername → payer_id, and inserts into
 *   `requests` with the service role key. Requester is the verified caller, never a client field.
 * - Payers see new requests live via a Supabase realtime subscription on `requests`.
 * - `splitId` links the request to a group split (set by the groups feature).
 */
export async function createRequest(
  toUsername: string,
  amount: string,
  note?: string,
  splitId?: string,
): Promise<PaymentRequest> {
  void toUsername;
  void amount;
  void note;
  void splitId;
  throw new Error("createRequest: not implemented yet");
}
