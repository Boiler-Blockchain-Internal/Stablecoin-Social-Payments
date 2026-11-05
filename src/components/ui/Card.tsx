import type { HTMLAttributes } from "react";

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`rounded-xl border border-zinc-200 bg-white p-4 ${className}`} />;
}
