"use client";

import { Bot, Building2, Gauge, Mail, Mails, Network, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/admin", label: "Overview", icon: Gauge, exact: true },
  { href: "/admin/users", label: "People and invites", icon: Users },
  { href: "/admin/companies", label: "Companies", icon: Building2 },
  { href: "/admin/sources", label: "Job boards", icon: Network },
  { href: "/admin/ai", label: "AI and budget", icon: Bot },
  { href: "/admin/email", label: "Email delivery", icon: Mail },
  { href: "/admin/mailbox", label: "Mailbox sync", icon: Mails },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0">
      <ul className="flex gap-1 lg:sticky lg:top-24 lg:flex-col lg:gap-0.5">
        {ITEMS.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className="flex min-h-10 items-center gap-2 rounded-lg px-2.5 text-sm font-medium whitespace-nowrap text-muted transition-colors hover:bg-surface-2 hover:text-text aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent"
              >
                <Icon aria-hidden className="size-4" /> {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
