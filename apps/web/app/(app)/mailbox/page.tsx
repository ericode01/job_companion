import type { Metadata } from "next";
import { MailboxSetup } from "@/components/MailboxSetup";
import { requirePageUser } from "@/lib/session";

export const metadata: Metadata = { title: "Mailbox" };

export default async function MailboxPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const user = await requirePageUser();
  const { connected, error } = await searchParams;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Let me keep your pipeline up to date</h1>
        <p className="text-sm text-muted">
          Connect your inbox, read-only. Confirmations, interview invites, rejections and offers move your cards, and anything that needs a reply is flagged.
        </p>
      </div>
      <MailboxSetup connected={connected ?? null} error={error ?? null} isAdmin={user.role === "admin"} />
    </div>
  );
}
