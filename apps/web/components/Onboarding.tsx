"use client";

import type { OnboardingStep } from "@jd/core/schema";
import { ArrowLeft, ArrowRight, Check, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export const STEPS: { key: Exclude<OnboardingStep, "done">; label: string }[] = [
  { key: "search", label: "What you want" },
  { key: "resume", label: "Resume" },
  { key: "about", label: "About you" },
  { key: "answers", label: "Common questions" },
];

/** Moves onboarding to a step and remembers it, so leaving and coming back resumes there. */
export function useStepNav() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const go = async (step: OnboardingStep) => {
    setBusy(true);
    await fetch("/api/me", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ onboardingStep: step }) });
    router.push(`/welcome/${step}`);
  };
  return { go, busy };
}

export function Progress({ current }: { current: OnboardingStep }) {
  const index = current === "done" ? STEPS.length : STEPS.findIndex((s) => s.key === current);
  return (
    <nav aria-label="Setup progress" className="mb-8">
      <p className="mb-3 text-sm font-medium text-muted">
        {current === "done" ? "All done" : `Step ${index + 1} of ${STEPS.length}`}
      </p>
      <ol className="grid grid-cols-4 gap-2">
        {STEPS.map((s, i) => {
          const state = i < index ? "done" : i === index ? "current" : "todo";
          return (
            <li key={s.key} aria-current={state === "current" ? "step" : undefined}>
              <span aria-hidden className={`block h-1.5 rounded-full ${state === "todo" ? "bg-surface-2" : "bg-accent"}`} />
              <span className={`mt-2 hidden items-center gap-1 text-xs sm:flex ${state === "current" ? "font-semibold text-text" : "text-muted"}`}>
                {state === "done" && <Check aria-hidden className="size-3 text-accent" />}
                {s.label}
                {state === "done" && <span className="sr-only">(done)</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Why this step is worth it: three short, concrete payoffs. */
export function Benefits({ items }: { items: { icon: React.ComponentType<{ className?: string }>; title: string; body: string }[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-3">
      {items.map(({ icon: Icon, title, body }) => (
        <li key={title} className="rounded-xl border border-border bg-surface p-4">
          <Icon aria-hidden className="mb-2 size-5 text-accent" />
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-0.5 text-sm text-muted">{body}</p>
        </li>
      ))}
    </ul>
  );
}

export function StepFooter({
  back,
  next,
  nextLabel = "Continue",
  nextDisabled,
  skip,
  skipLabel = "Skip this step",
  busy,
}: {
  back?: () => void;
  next?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  skip?: () => void;
  skipLabel?: string;
  busy?: boolean;
}) {
  return (
    <div className="flex flex-col-reverse gap-2 border-t border-border pt-5 sm:flex-row sm:items-center">
      {back && (
        <button type="button" className="btn-ghost" onClick={back} disabled={busy}>
          <ArrowLeft aria-hidden className="size-4" /> Back
        </button>
      )}
      <div className="flex flex-col-reverse gap-2 sm:ml-auto sm:flex-row sm:items-center">
        {skip && (
          <button type="button" className="btn-ghost" onClick={skip} disabled={busy}>
            {skipLabel}
          </button>
        )}
        {next && (
          <button type="button" className="btn-primary min-h-10" onClick={next} disabled={busy || nextDisabled}>
            {nextLabel} <ArrowRight aria-hidden className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      className="btn-ghost"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.replace("/login");
      }}
    >
      <LogOut aria-hidden className="size-4" /> Sign out
    </button>
  );
}
