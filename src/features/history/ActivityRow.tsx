import Link from "next/link";
import type { ActivityItem } from "./types";

export function ActivityRow({ item, userId }: { item: ActivityItem; userId: string }) {
  const from = item.kind === "transaction" ? item.fromUser : item.payerId;
  const sent = from === userId;
  const otherName = item.kind === "transaction"
    ? (sent ? item.toUsername : item.fromUsername)
    : (sent ? item.requesterUsername : item.payerUsername);
  const displayName = otherName ? `@${otherName}` : "User";
  const label = item.kind === "request"
    ? (sent ? `Requested by ${displayName}` : `Requested from ${displayName}`)
    : (sent ? `Paid ${displayName}` : `Received from ${displayName}`);
  const amount = Number(item.amount);
  const readableAmount = Number.isFinite(amount)
    ? amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })
    : item.amount;
  const date = new Date(item.createdAt);
  return (
    <article className="flex items-start gap-3 border-b border-zinc-100 py-4 last:border-b-0">
      <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-lg">
        {item.kind === "request" ? "◷" : sent ? "↗" : "↙"}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-semibold">{label}</p>
        {item.note && <p className="break-words text-xs text-zinc-600">{item.note}</p>}
        <p className="text-xs text-zinc-500">
          {item.kind === "request" ? `Request ${item.status}` : item.status === "pending" && !item.txHash ? "Transfer processing" : `Transfer ${item.status}`}
          {Number.isNaN(date.getTime()) ? "" : ` · ${date.toLocaleString()}`}
        </p>
        {item.kind === "request" && item.status === "pending" &&
          <Link className="text-xs font-medium text-blue-700 underline" href="/requests">View request</Link>}
      </div>
      <p className={`shrink-0 text-right text-sm font-semibold tabular-nums ${item.kind === "transaction" && item.status === "failed" ? "text-zinc-400 line-through" : ""}`}>
        {item.kind === "request" ? "" : sent ? "−" : "+"}{readableAmount}
        <span className="block text-xs font-normal text-zinc-500">USDC</span>
      </p>
    </article>
  );
}
