import { redirect } from "next/navigation";
import { requirePageUser } from "@/lib/session";

export default async function Welcome() {
  const user = await requirePageUser({ allowOnboarding: true });
  redirect(user.onboardingStep ? `/welcome/${user.onboardingStep}` : "/");
}
