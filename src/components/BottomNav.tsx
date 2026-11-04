"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { label: "Home", href: "/", symbol: "⌂" },
  { label: "Send", href: "/send", symbol: "↗" },
  { label: "Requests", href: "/requests", symbol: "⇄" },
  { label: "Groups", href: "/groups", symbol: "♧" },
  { label: "Activity", href: "/activity", symbol: "◷" },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main navigation" className="sticky bottom-0 z-40 border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="mx-auto flex max-w-xl justify-around">
        {tabs.map(({ href, label, symbol }) => {
          const active = pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined}
              className={`flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-3 text-[11px] ${active ? "font-semibold text-blue-700" : "text-zinc-600"}`}>
              <span aria-hidden="true" className="text-xl leading-none">{symbol}</span>
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
