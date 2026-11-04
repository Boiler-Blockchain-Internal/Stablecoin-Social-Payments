import type { ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" };

export function Button({ variant = "primary", className = "", ...props }: Props) {
  return <button {...props} className={`rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${variant === "primary" ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-zinc-200 text-zinc-900 hover:bg-zinc-300"} ${className}`} />;
}
