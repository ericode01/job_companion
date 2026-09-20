"use client";

import { Briefcase, KanbanSquare, Mails, MessageSquareText } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MailboxBadge } from "@/components/AppNav";

/**
 * Phones only. The header can't hold these, and hiding them behind the avatar meant a reply you
 * had to go looking for. Four destinations, each with its own count, always in reach.
 */
export function BottomNav({
  searchId,
  actions,
  inbox,
  mailbox,
}: {
  /** The search to open under "Jobs" when you aren't already in one. */
  searchId: number | null;
  actions: number;
  inbox: number;
  mailbox: MailboxBadge;
}) {
  const pathname = usePathname();
  const inSearch = pathname.match(/^\/d\/(\d+)/)?.[1];
  const jobs = inSearch ? `/d/${inSearch}` : searchId ? `/d/${searchId}` : "/searches/new";
  const items = [
    { href: jobs, label: "Jobs", icon: Briefcase, active: pathname.startsWith("/d/") || pathname === "/searches/new", count: 0, unit: "" },
    { href: "/pipeline", label: "Pipeline", icon: KanbanSquare, active: pathname.startsWith("/pipeline"), count: actions, unit: actions === 1 ? "email needs your reply" : "emails need your reply" },
    { href: "/answers", label: "Answers", icon: MessageSquareText, active: pathname.startsWith("/answers"), count: inbox, unit: inbox === 1 ? "question to answer" : "questions to answer" },
    { href: "/mailbox", label: "Mailbox", icon: Mails, active: pathname.startsWith("/mailbox"), count: mailbox.review, unit: mailbox.review === 1 ? "email to check" : "emails to check" },
  ];
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur sm:hidden">
      <ul className="flex items-stretch justify-around pb-[env(safe-area-inset-bottom,0px)]">
        {items.map((t) => (
          <li key={t.label} className="flex-1">
            <Link
              href={t.href}
              aria-current={t.active ? "page" : undefined}
              className="flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-medium text-muted transition-colors aria-[current=page]:text-accent"
            >
              <span className="relative">
                <t.icon aria-hidden className="size-5" />
                {t.count > 0 ? (
                  <span className="absolute -top-1.5 -right-2.5 min-w-4 rounded-full bg-warn-soft px-1 text-[10px] leading-4 font-semibold text-warn tabular-nums">
                    {t.count > 9 ? "9+" : t.count}
                  </span>
                ) : (
                  t.label === "Mailbox" &&
                  mailbox.state !== "none" && (
                    <span aria-hidden className={`absolute -top-0.5 -right-1 size-2 rounded-full ${mailbox.state === "ok" ? "bg-good" : "bg-warn"}`} />
                  )
                )}
              </span>
              {t.label}
              {t.count > 0 && (
                <span className="sr-only">
                  , {t.count} {t.unit}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
