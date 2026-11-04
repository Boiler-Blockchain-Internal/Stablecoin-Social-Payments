"use client";

import { AuthButton } from "@/features/auth/AuthButton";
import { BottomNav } from "@/components/BottomNav";

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-zinc-50 text-zinc-900">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3">
        <span className="text-lg font-semibold">StablePay</span>
        <AuthButton />
      </header>
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-6">{children}</main>
      <BottomNav />
    </div>
  );
}
