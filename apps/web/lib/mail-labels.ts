import type { EmailKind, InterviewRound } from "@jd/core/shared";
import {
  Award,
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  CircleX,
  ClipboardList,
  Info,
  MailCheck,
  MailX,
  type LucideIcon,
} from "lucide-react";

/** Every kind has an icon and words, so meaning never rests on color alone. */
export const KIND_META: Record<EmailKind, { label: string; icon: LucideIcon; tone: string }> = {
  application_received: { label: "Application received", icon: MailCheck, tone: "bg-good-soft text-good" },
  interview_request: { label: "Interview request", icon: CalendarPlus, tone: "bg-accent-soft text-accent" },
  interview_scheduled: { label: "Interview scheduled", icon: CalendarCheck, tone: "bg-accent-soft text-accent" },
  interview_update: { label: "Interview update", icon: CalendarClock, tone: "bg-accent-soft text-accent" },
  assessment: { label: "Assessment", icon: ClipboardList, tone: "bg-accent-soft text-accent" },
  rejection: { label: "Not moving forward", icon: CircleX, tone: "bg-surface-2 text-muted" },
  offer: { label: "Offer", icon: Award, tone: "bg-good-soft text-good" },
  other_update: { label: "Update", icon: Info, tone: "bg-surface-2 text-muted" },
  unrelated: { label: "Not a job email", icon: MailX, tone: "bg-surface-2 text-muted" },
};

export const ROUND_META: Record<InterviewRound, { label: string; short: string }> = {
  recruiter_call: { label: "Recruiter call", short: "Recruiter" },
  screening: { label: "Screening", short: "Screen" },
  assessment: { label: "Assessment", short: "Assessment" },
  hiring_manager: { label: "Hiring manager", short: "Hiring manager" },
  onsite_virtual: { label: "Onsite (virtual)", short: "Onsite (virtual)" },
  onsite_in_person: { label: "Onsite (in person)", short: "Onsite (in person)" },
  other: { label: "Other round", short: "Other" },
};

export function roundName(round: InterviewRound, label?: string | null, short = false): string {
  if (round === "other" && label) return label;
  return short ? ROUND_META[round].short : ROUND_META[round].label;
}

/** "Thu, Sep 25" or "Thu, Sep 25, 2:00 PM" when the time matters. */
export function shortDate(d: Date | string | null | undefined, withTime = false): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  // Midnight and 11:59 PM mean "that day" (a date with no time, or an end-of-day deadline).
  const hasTime = withTime && !(date.getHours() === 0 && date.getMinutes() === 0) && !(date.getHours() === 23 && date.getMinutes() === 59);
  return date.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
    ...(hasTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

/** "due today", "due tomorrow", "due in 3 days", "overdue by 2 days". */
export function dueLabel(d: Date | string | null | undefined): { text: string; overdue: boolean } | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  const day = (x: Date) => Math.floor(new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime() / 86_400_000);
  const diff = day(date) - day(new Date());
  if (diff < 0) return { text: `overdue by ${-diff} day${diff === -1 ? "" : "s"}`, overdue: true };
  if (diff === 0) return { text: "due today", overdue: false };
  if (diff === 1) return { text: "due tomorrow", overdue: false };
  return { text: `due in ${diff} days`, overdue: false };
}

/** Where "Open" goes: the Gmail thread, or Apple Mail (Mac) by Message-ID for other providers. */
export function openLink(e: { webLink: string | null; rfcMessageId: string | null }): { href: string; label: string } | null {
  if (e.webLink) return { href: e.webLink, label: "Open in Gmail" };
  if (e.rfcMessageId) return { href: `message://${encodeURIComponent(e.rfcMessageId.startsWith("<") ? e.rfcMessageId : `<${e.rfcMessageId}>`)}`, label: "Open in Mail" };
  return null;
}

/** A reply that works in any mail app, for providers without a web link. */
export function replyLink(e: { fromAddress: string | null; subject: string | null }): string | null {
  if (!e.fromAddress) return null;
  const subject = e.subject ? (/^re:/i.test(e.subject) ? e.subject : `Re: ${e.subject}`) : "";
  return `mailto:${e.fromAddress}?subject=${encodeURIComponent(subject)}`;
}

/**
 * Does an email's role name mean the same job as the card's? Loosely mirrors the linker's title
 * comparison (packages/mail/src/link.ts) for display only: when it says no, the timeline shows the
 * email's own role, so a wrong merge is visible instead of hidden.
 */
const ROLE_NOISE = /\b(the|a|an|of|and|for|to|in|at|on|with|role|position|remote|hybrid|sr|senior|jr|junior|staff|principal|lead)\b/g;
export function sameRole(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return true;
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9 ]+/g, " ")
        .replace(ROLE_NOISE, " ")
        .split(/\s+/)
        .filter(Boolean),
    );
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return true;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both) >= 0.55;
}
