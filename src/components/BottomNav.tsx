"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useIncomingRequests } from "@/features/requests/useIncomingRequests";

const tabs = [
  { label: "Home", href: "/", symbol: "⌂" },
  { label: "Send", href: "/send", symbol: "↗" },
  { label: "Requests", href: "/requests", symbol: "⇄" },
  { label: "Groups", href: "/groups", symbol: "♧" },
  { label: "Activity", href: "/activity", symbol: "◷" },
];

export function BottomNav() {
  const pathname = usePathname();
  const { pending, notice, dismiss } = useIncomingRequests();
  const toast = notice && pathname !== "/requests" ? (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-zinc-900 py-1 pl-4 pr-1 text-sm text-white shadow-lg">
      <Link href="/requests" onClick={dismiss} className="min-w-0 flex-1 py-2">
        <span className="font-semibold">@{notice.username ?? "someone"}</span> requested {notice.amount} USDC
        <span className="ml-1 underline">View</span>
      </Link>
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="min-h-11 min-w-11 shrink-0 text-zinc-400">✕</button>
    </div>
  ) : null;
  return <BottomNavLinks pathname={pathname} badges={{ "/requests": pending }} toast={toast} />;
}

export function BottomNavLinks({ pathname, badges = {}, toast = null }: {
  pathname: string | null;
  badges?: Record<string, number>;
  toast?: React.ReactNode;
}) {
  return (
    <nav aria-label="Main navigation" className="sticky bottom-0 z-40 border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      {/* Always mounted so screen readers announce the notice; floats just above the nav. */}
      <div role="status" className="absolute inset-x-0 bottom-full mx-auto mb-2 w-full max-w-xl px-4">{toast}</div>
      <div className="mx-auto flex max-w-xl justify-around">
        {tabs.map(({ href, label, symbol }) => {
          const active = pathname !== null && (pathname === href || (href !== "/" && pathname.startsWith(`${href}/`)));
          const badge = badges[href] ?? 0;
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined}
              aria-label={badge ? `${label}, ${badge} waiting` : undefined}
              className={`flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-3 text-[11px] ${active ? "font-semibold text-blue-700" : "text-zinc-600"}`}>
              <span aria-hidden="true" className="relative text-xl leading-none">
                {symbol}
                {badge > 0 && (
                  <span className="absolute -right-3 -top-1.5 min-w-4 rounded-full bg-rose-600 px-1 text-center text-[10px] font-semibold leading-4 text-white">
                    {badge > 9 ? "9+" : badge}
                  </span>
                )}
              </span>
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
