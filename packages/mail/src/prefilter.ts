import type { EmailHeaders } from "./types";

/**
 * Rules only, no AI: which emails are worth reading at all. Most mail is dropped here on its
 * headers, so bodies are downloaded (and sent to the AI) only for likely job emails.
 */

/** Applicant-tracking and scheduling systems that send on a company's behalf. */
export const ATS_SENDER_DOMAINS = [
  "greenhouse.io",
  "greenhouse-mail.io",
  "lever.co",
  "hire.lever.co",
  "ashbyhq.com",
  "myworkday.com",
  "myworkdayjobs.com",
  "workday.com",
  "smartrecruiters.com",
  "smartrecruitersmail.com",
  "icims.com",
  "jobvite.com",
  "workablemail.com",
  "workable.com",
  "bamboohr.com",
  "rippling.com",
  "ats.rippling.com",
  "gem.com",
  "goodtime.io",
  "modernloop.io",
  "calendly.com",
  "successfactors.com",
  "taleo.net",
  "breezy.hr",
  "recruitee.com",
  "teamtailor-mail.com",
  "pinpointhq.com",
  "dover.com",
  "wellfound.com",
  "hackerrank.com",
  "codesignal.com",
  "codility.com",
  "coderpad.io",
  "karat.io",
];

/** Job alerts and recommendation newsletters: about jobs, but not about your applications. */
const ALERT_SENDERS = [
  /^jobalerts-noreply@linkedin\.com$/,
  /^jobs-listings@linkedin\.com$/,
  /^messages-noreply@linkedin\.com$/,
  /^news(letter)?@/,
  /@(alert\.)?indeed\.com$/,
  /@glassdoor\.com$/,
  /@ziprecruiter\.com$/,
  /@(mail\.)?dice\.com$/,
  /@builtin\.com$/,
  /@otta\.com$/,
];

/** LinkedIn Easy Apply confirmations come from a generic sender; the subject gives them away. */
const LINKEDIN_APPLIED = /your application was (sent|viewed)|application (sent|submitted) to/i;

const SUBJECT_WORDS =
  /\b(appl(y|ied|ying|ication)s?|candida(cy|te)|interview(s|ing)?|recruit(er|ing|ment)?|talent|hiring|offer|next steps?|phone screen|screening|on-?site|assessment|take[- ]home|coding (challenge|exercise|test)|availability|schedul(e|ing)|thank you for your interest|position|role|opportunity|update on your)\b/i;

/** In a body preview, these only come up when someone writes about your own candidacy. */
const SNIPPET_STRONG = /\byour (application|candidacy|interview|resume)\b|\bthe hiring (team|manager)\b|\b(role|position) you applied\b|\bapplied (for|to) (the|our)\b/i;

const RECRUITING_LOCALPARTS = /^(recruit|talent|careers?|jobs?|hiring|people|hr|no-?reply|notifications?)/i;

export interface PrefilterContext {
  /** Domains of companies the person has applied to (from company.domain). */
  companyDomains: Set<string>;
  /** Threads already known to be about an application. */
  trackedThreads: Set<string>;
  /** The mailbox's own addresses: mail you sent isn't news. */
  selfAddresses: Set<string>;
  /** Where digests come from, in case an old one lacks the header. */
  digestFrom: Set<string>;
}

const domainOf = (address: string | null) => address?.split("@")[1]?.toLowerCase() ?? "";
const underDomain = (domain: string, list: Iterable<string>) => {
  for (const d of list) if (domain === d || domain.endsWith(`.${d}`)) return true;
  return false;
};

export function prefilter(h: EmailHeaders, ctx: PrefilterContext): { keep: boolean; reason: string } {
  const from = h.fromAddress?.toLowerCase() ?? "";
  const domain = domainOf(from);
  const subject = h.subject ?? "";

  if (h.fromJobCompanion) return { keep: false, reason: "Job Companion digest" };
  if (ctx.selfAddresses.has(from)) return { keep: false, reason: "sent by you" };
  if (ctx.digestFrom.has(from) && /new match|job companion/i.test(subject)) return { keep: false, reason: "Job Companion digest" };
  if (h.threadId && ctx.trackedThreads.has(h.threadId)) return { keep: true, reason: "reply in a tracked thread" };
  if (domain === "linkedin.com" && from.startsWith("jobs-noreply") && LINKEDIN_APPLIED.test(subject)) {
    return { keep: true, reason: "LinkedIn application" };
  }
  if (ALERT_SENDERS.some((r) => r.test(from))) return { keep: false, reason: "job alert" };

  let score = 0;
  if (underDomain(domain, ATS_SENDER_DOMAINS)) score += 3;
  if (underDomain(domain, ctx.companyDomains)) score += 3;
  if (SUBJECT_WORDS.test(subject)) score += 2;
  if (h.snippet && SNIPPET_STRONG.test(h.snippet)) score += 3;
  if (RECRUITING_LOCALPARTS.test(from.split("@")[0] ?? "")) score += 1;
  // Mailing lists are newsletters unless an ATS or a company you applied to sent them.
  if (h.listId && score < 3) score -= 2;
  return score >= 3 ? { keep: true, reason: `score ${score}` } : { keep: false, reason: `score ${score}` };
}

/**
 * Gmail search that narrows the mailbox server-side before anything is downloaded. It's
 * deliberately broad; `prefilter` and the classifier do the precise work.
 */
export function gmailQuery(opts: { newerThanDays?: number; afterEpochSec?: number; companyDomains: string[] }): string {
  const senders = [...ATS_SENDER_DOMAINS, ...opts.companyDomains.slice(0, 40), "jobs-noreply@linkedin.com"];
  const words = [
    "application",
    "applying",
    "applied",
    "interview",
    "candidacy",
    "recruiter",
    '"next steps"',
    '"phone screen"',
    "onsite",
    '"take-home"',
    "assessment",
    "offer",
    '"thank you for your interest"',
  ];
  const window = opts.afterEpochSec ? `after:${opts.afterEpochSec}` : `newer_than:${opts.newerThanDays ?? 90}d`;
  // Body phrases catch a recruiter's first email from an unknown domain under a vague subject.
  const phrases = ['"your application"', '"your candidacy"', '"the hiring team"', '"the role you applied"'];
  return `{from:(${senders.join(" OR ")}) subject:(${words.join(" OR ")}) ${phrases.join(" ")}} -category:promotions -category:social -category:forums -from:me ${window}`;
}
