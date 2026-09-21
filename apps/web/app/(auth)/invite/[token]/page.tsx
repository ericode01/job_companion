import { findOpenInvite } from "@jd/core";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";

export const metadata: Metadata = { title: "Join" };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await findOpenInvite(token);
  if (!invite) {
    return (
      <div className="card space-y-2 p-6 text-center">
        <h1 className="text-lg font-semibold">This invite link doesn&apos;t work</h1>
        <p className="text-sm text-muted">It may have expired or already been used. Ask your admin for a new one.</p>
        <Link href="/login" className="btn mt-2">
          Go to sign in
        </Link>
      </div>
    );
  }
  return (
    <>
      <div className="space-y-1 text-center">
        <h1 className="text-xl font-bold tracking-tight">You&apos;re invited</h1>
        <p className="text-sm text-muted">Create your account. Next, a few quick questions so I can find the right jobs for you.</p>
      </div>
      <Suspense>
        <AuthForm mode={{ kind: "invite", token, email: invite.email }} />
      </Suspense>
    </>
  );
}
