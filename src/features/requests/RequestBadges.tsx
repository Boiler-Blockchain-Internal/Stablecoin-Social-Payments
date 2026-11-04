"use client";

import type { PaymentRequest } from "@/features/requests/createRequest";

export type RequestWithUsers = PaymentRequest & {
  requester_username: string | null;
  payer_username: string | null;
};

export function StatusBadge({ status }: { status: "pending" | "paid" | "declined" }) {
  const map = {
    pending: { label: "Pending", className: "bg-amber-100 text-amber-800" },
    paid: { label: "Paid", className: "bg-emerald-100 text-emerald-800" },
    declined: { label: "Declined", className: "bg-rose-100 text-rose-800" },
  } as const;
  const s = map[status] ?? map.pending;
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${s.className}`}>
      {s.label}
    </span>
  );
}
