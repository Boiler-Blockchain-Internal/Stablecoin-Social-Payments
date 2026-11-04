import { Suspense } from "react";
import { Shell } from "@/components/Shell";
import { GroupDetails } from "@/features/groups/GroupDetails";

async function GroupFromParams({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GroupDetails groupId={id} />;
}

export default function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Shell>
      <Suspense fallback={<p role="status" className="text-sm text-zinc-600">Loading group…</p>}>
        <GroupFromParams params={params} />
      </Suspense>
    </Shell>
  );
}
