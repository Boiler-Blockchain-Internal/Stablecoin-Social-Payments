"use client";

import { Shell } from "@/components/Shell";
import { CreateGroupForm } from "@/features/groups/CreateGroupForm";
import { GroupsGate } from "@/features/groups/GroupsGate";

export default function NewGroupPage() {
  return (
    <Shell>
      <GroupsGate>{(me) => <CreateGroupForm myUsername={me.username} />}</GroupsGate>
    </Shell>
  );
}
