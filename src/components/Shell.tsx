"use client";

import { AuthButton } from "@/features/auth/AuthButton";

/** App frame: header with the app name and login/logout. Every page renders inside this. */
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 text-zinc-900">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3">
        <span className="text-lg font-semibold">StablePay</span>
        <AuthButton />
      </header>
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
