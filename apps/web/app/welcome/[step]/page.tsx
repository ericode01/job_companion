import { getProfile, getUserSettings } from "@jd/core";
import { ONBOARDING_STEPS, type OnboardingStep } from "@jd/core/schema";
import { listAnswers } from "@jd/apply";
import { currentMasterResume } from "@jd/research";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AboutStep, AnswersStep, DoneStep, ResumeStep, SearchStep } from "@/components/OnboardingSteps";
import { listDashboards } from "@/lib/dashboards";
import { requirePageUser } from "@/lib/session";

export const metadata: Metadata = { title: "Getting started" };
export const dynamic = "force-dynamic";

export default async function WelcomeStep({ params }: { params: Promise<{ step: string }> }) {
  const { step } = await params;
  if (!ONBOARDING_STEPS.includes(step as OnboardingStep)) notFound();
  const user = await requirePageUser({ allowOnboarding: true });
  // Finished onboarding already: the app is the place to change things now.
  if (!user.onboardingStep) redirect("/");

  const dashboards = listDashboards(user.id);
  const first = dashboards[0] ?? null;

  switch (step as OnboardingStep) {
    case "search":
      return (
        <SearchStep
          firstName={user.name.split(/\s+/)[0] ?? user.name}
          existing={first ? { id: first.id, name: first.name } : null}
          defaultRemote={getUserSettings(user.id, "search").includeRemoteUS}
        />
      );
    case "resume":
      return <ResumeStep />;
    case "about":
      return <AboutStep />;
    case "answers":
      return <AnswersStep />;
    case "done": {
      const profile = getProfile(user.id);
      // Everyone starts with the two work-authorization answers; more means the step was used.
      const answered = listAnswers(user.id).filter((a) => a.category !== "eeo").length;
      return (
        <DoneStep
          dashboardId={first?.id ?? null}
          checklist={[
            { label: first ? `Your first dashboard: ${first.name}` : "A job search", done: Boolean(first), href: "/searches/new" },
            { label: "Resume", done: Boolean(currentMasterResume(user.id)), href: "/profile#resume" },
            { label: "About you", done: Boolean(profile?.about || profile?.writingSample), href: "/profile#about" },
            { label: "Common application questions", done: answered > 2, href: "/answers" },
          ]}
        />
      );
    }
  }
}
