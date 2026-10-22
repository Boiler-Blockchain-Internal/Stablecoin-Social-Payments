import { Shell } from "@/components/Shell";
import { ProfileGate } from "@/features/auth/ProfileGate";

export default function Home() {
  return (
    <Shell>
      <ProfileGate />
    </Shell>
  );
}
