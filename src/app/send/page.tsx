import Link from "next/link";
import { Shell } from "@/components/Shell";
import { Card } from "@/components/ui/Card";

export default function SendPage() {
  return (
    <Shell>
      <h1 className="mb-4 text-2xl font-bold">Send USDC</h1>
      <Card className="space-y-3">
        <p className="text-sm text-zinc-700">The production send-by-username flow is being built by the Send feature owner.</p>
        <p className="text-sm text-zinc-600">The existing developer test screen uses a wallet address and is not the final payment interface.</p>
        <Link className="inline-block text-sm font-medium text-blue-700 underline" href="/test-send">Open developer transfer test</Link>
      </Card>
    </Shell>
  );
}
