"use client";

import { Shell } from "@/components/Shell";
import { GroupList } from "@/features/groups/GroupList";
import { GroupsGate } from "@/features/groups/GroupsGate";

export default function GroupsPage() {
  return (
    <Shell>
      <GroupsGate>{(me) => <GroupList userId={me.id} />}</GroupsGate>
    </Shell>
  );
}
