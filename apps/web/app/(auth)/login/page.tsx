import { userCount } from "@jd/core";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";
import { currentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await userCount() === 0) redirect("/setup");
  if (await currentUser()) redirect("/");
  return (
    <>
      <div className="text-center">
        <h1 className="text-xl font-bold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted">Sign in to pick up your search where you left off.</p>
      </div>
      <Suspense>
        <AuthForm mode={{ kind: "login" }} />
      </Suspense>
      <p className="text-center text-xs text-muted">New here? Ask your admin for an invite link.</p>
    </>
  );
}
