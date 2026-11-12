import { Suspense } from "react";
import { Shell } from "@/components/Shell";
import { DepositScreen } from "@/features/deposits/DepositScreen";

export default function DepositPage() {
  // DepositScreen reads the URL's ?source=, which suspends during prerender without a boundary.
  return (
    <Shell>
      <Suspense fallback={<p role="status" className="py-16 text-center text-sm text-zinc-500">Loading…</p>}>
        <DepositScreen />
      </Suspense>
    </Shell>
  );
}
