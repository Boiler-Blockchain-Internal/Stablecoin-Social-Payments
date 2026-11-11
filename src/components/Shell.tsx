"use client";

import Link from "next/link";
import { Suspense } from "react";
import { AuthButton } from "@/features/auth/AuthButton";
import { BottomNav, BottomNavLinks } from "@/components/BottomNav";

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-zinc-50 text-zinc-900">
      <header className="flex items-center justify-between gap-2 border-b border-zinc-200 bg-white px-4 py-3">
        <Link href="/" className="shrink-0 text-lg font-semibold tracking-tight">StablePay</Link>
        <div className="flex shrink-0 items-center gap-1">
          <Link href="/deposit" className="rounded-lg px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50">Deposit</Link>
          <Link href="/profile" className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950">Profile</Link>
          <AuthButton />
        </div>
      </header>
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-6">{children}</main>
      <Suspense fallback={<BottomNavLinks pathname={null} />}>
        <BottomNav />
      </Suspense>
    </div>
  );
}
