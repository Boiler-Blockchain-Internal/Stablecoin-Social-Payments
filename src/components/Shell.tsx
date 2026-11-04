"use client";

import { AuthButton } from "@/features/auth/AuthButton";
import Link from "next/link";

/** App frame: header with the app name and login/logout. Every page renders inside this. */
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 text-zinc-900">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3">
        <Link href="/" className="shrink-0 text-lg font-semibold tracking-tight">StablePay</Link>
        <nav aria-label="Main navigation" className="flex items-center gap-1 sm:gap-2">
          <Link href="/send" className="rounded-lg px-2.5 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 sm:px-3 sm:text-sm">Send</Link>
          <Link href="/requests" className="rounded-lg px-2.5 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 sm:px-3 sm:text-sm">Requests</Link>
        </nav>
        <div className="shrink-0"><AuthButton /></div>
      </header>
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
