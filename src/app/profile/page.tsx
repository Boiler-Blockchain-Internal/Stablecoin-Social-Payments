import type { Metadata } from "next";
import { Shell } from "@/components/Shell";
import { ProfileDetails } from "@/features/auth/ProfileDetails";

export const metadata: Metadata = { title: "Your profile | StablePay" };

export default function ProfilePage() {
  return <Shell><ProfileDetails /></Shell>;
}
