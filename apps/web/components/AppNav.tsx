"use client";

import { BellRing, KanbanSquare, Mails, MessageSquareText, Puzzle, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface MailboxBadge {
  /** none: never connected; attention: needs reconnecting or failing; ok: checking normally. */
  state: "none" | "attention" | "ok";
  /** Emails waiting in "Check these". */
  review: number;
}

const linkCls =
  "relative inline-flex min-h-10 min-w-10 items-center justify-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent";

function Dot({ tone }: { tone: "good" | "warn" }) {
  return <span aria-hidden className={`absolute top-2 right-2 size-2 rounded-full ring-2 ring-surface lg:static lg:ring-0 ${tone === "good" ? "bg-good" : "bg-warn"}`} />;
}

/** The places that belong to you, not to one search: pipeline, profile, answers, mailbox, extension. */
export function AppNav({ inbox, actions, extensionConnected, mailbox }: { inbox: number; actions: number; extensionConnected: boolean; mailbox: MailboxBadge }) {
  const pathname = usePathname();
  const current = (href: string) => (pathname.startsWith(href) ? "page" : undefined);
  return (
    <nav aria-label="Your applications and tools" className="hidden items-center gap-0.5 sm:flex">
      <Link href="/pipeline" aria-current={current("/pipeline")} className={linkCls}>
        <KanbanSquare aria-hidden className="size-4" />
        <span className="hidden lg:inline">Pipeline</span>
        {actions > 0 && (
          <span className="chip min-w-5 justify-center bg-warn-soft px-1.5 text-warn tabular-nums">
            <BellRing aria-hidden className="size-3" />
            {actions}
            <span className="sr-only"> {actions === 1 ? "email needs" : "emails need"} your reply</span>
          </span>
        )}
      </Link>
      <Link href="/profile" aria-current={current("/profile")} className={linkCls}>
        <UserRound aria-hidden className="size-4" />
        <span className="hidden lg:inline">Profile</span>
      </Link>
      <Link href="/answers" aria-current={current("/answers")} className={linkCls}>
        <MessageSquareText aria-hidden className="size-4" />
        <span className="hidden lg:inline">Answers</span>
        {inbox > 0 && (
          <span className="chip min-w-5 justify-center bg-warn-soft px-1.5 text-warn tabular-nums">
            {inbox}
            <span className="sr-only"> unanswered</span>
          </span>
        )}
      </Link>
      <Link href="/mailbox" aria-current={current("/mailbox")} className={linkCls}>
        <Mails aria-hidden className="size-4" />
        <span className="hidden lg:inline">Mailbox</span>
        {mailbox.review > 0 ? (
          <span className="chip min-w-5 justify-center bg-warn-soft px-1.5 text-warn tabular-nums">
            {mailbox.review}
            <span className="sr-only"> {mailbox.review === 1 ? "email" : "emails"} to check</span>
          </span>
        ) : (
          mailbox.state !== "none" && <Dot tone={mailbox.state === "ok" ? "good" : "warn"} />
        )}
        {mailbox.state !== "none" && <span className="sr-only">{mailbox.state === "ok" ? "(connected)" : "(needs attention)"}</span>}
      </Link>
      <Link href="/extension" aria-current={current("/extension")} className={linkCls}>
        <Puzzle aria-hidden className="size-4" />
        <span className="hidden lg:inline">Extension</span>
        <Dot tone={extensionConnected ? "good" : "warn"} />
        <span className="sr-only">{extensionConnected ? "(connected)" : "(not set up)"}</span>
      </Link>
    </nav>
  );
}
