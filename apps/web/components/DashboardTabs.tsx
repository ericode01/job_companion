"use client";

import { Briefcase, Newspaper } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** A search is about finding jobs. What you've applied to lives in your pipeline, not here. */
export function DashboardTabs({ id, digestOn }: { id: number; digestOn: boolean }) {
  const pathname = usePathname();
  const base = `/d/${id}`;
  const tabs = [
    { href: base, label: "Jobs", icon: Briefcase, active: pathname === base },
    // "Digest", not "Email": the mailbox you connect is a different thing.
    { href: `${base}/digest`, label: "Digest", icon: Newspaper, active: pathname.startsWith(`${base}/digest`), state: digestOn ? "On" : "Off" },
  ];
  return (
    <nav aria-label="Dashboard" className="flex gap-5 overflow-x-auto border-b border-border whitespace-nowrap sm:gap-6">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.active ? "page" : undefined} className="tab">
          <t.icon aria-hidden className="size-4" />
          {t.label}
          {t.state && (
            <span className={`chip ${t.state === "On" ? "bg-good-soft text-good" : "bg-surface-2 text-muted"}`}>{t.state}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}
