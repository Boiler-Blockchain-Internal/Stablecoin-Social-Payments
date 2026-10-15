"use client";

import { usePrivy } from "@privy-io/react-auth";

export function AuthButton() {
  const { ready, authenticated, login, logout } = usePrivy();

  if (!ready) {
    return <span className="text-sm text-zinc-500">Loading…</span>;
  }

  return (
    <button
      type="button"
      onClick={authenticated ? logout : login}
      className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
    >
      {authenticated ? "Log out" : "Log in"}
    </button>
  );
}
