import { userCount } from "@jd/core";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";

export const metadata: Metadata = { title: "Set up" };
export const dynamic = "force-dynamic";

/** Only reachable while there are no accounts. */
export default function SetupPage() {
  if (userCount() > 0) redirect("/login");
  return (
    <>
      <div className="space-y-1 text-center">
        <h1 className="text-xl font-bold tracking-tight">Set up Job Companion</h1>
        <p className="text-sm text-muted">
          You&apos;ll be the admin. Anything already in this install — resume, searches, applications, answers — moves into your
          account. Others join with invite links you create.
        </p>
      </div>
      <Suspense>
        <AuthForm mode={{ kind: "setup" }} />
      </Suspense>
    </>
  );
}
