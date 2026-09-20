import { z } from "zod";

/* ---------- Mailbox sync (browser-safe) ---------- */

/** What a job email is about. `unrelated` rows keep only ids, so nothing is classified twice. */
export const EMAIL_KINDS = [
  "application_received",
  "interview_request",
  "interview_scheduled",
  "interview_update",
  "assessment",
  "rejection",
  "offer",
  "other_update",
  "unrelated",
] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

/** Interview rounds in the order they usually happen. */
export const INTERVIEW_ROUNDS = [
  "recruiter_call",
  "screening",
  "assessment",
  "hiring_manager",
  "onsite_virtual",
  "onsite_in_person",
  "other",
] as const;
export type InterviewRound = (typeof INTERVIEW_ROUNDS)[number];

export const ACTION_TYPES = ["reply", "schedule", "complete_assessment", "provide_info", "review_offer", "other"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** auto: applied without asking; needs_review: waiting for the person; confirmed: they checked or corrected it. */
export const REVIEW_STATES = ["auto", "needs_review", "confirmed", "dismissed"] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

/** How an application got into the tracker. */
export const APPLICATION_SOURCES = ["app", "extension", "email", "manual"] as const;
export type ApplicationSource = (typeof APPLICATION_SOURCES)[number];

export type StatusEventSource = "manual" | "extension" | "email";

export const EmailClassificationSchema = z.object({
  jobRelated: z.boolean().describe("True only for emails about the person's own job applications or interviews"),
  kind: z.enum(EMAIL_KINDS),
  round: z.enum(INTERVIEW_ROUNDS).nullable().describe("For interview and assessment emails: which round this is about"),
  roundLabel: z
    .string()
    .nullable()
    .describe("The round's own name if the email gives one, e.g. 'System design with the Platform team'. Short."),
  companyName: z.string().nullable().describe("The hiring company, not the job-board vendor (not Greenhouse, Lever, Workday, LinkedIn)"),
  jobTitle: z.string().nullable().describe("The role applied for, as written"),
  applicationRef: z.number().nullable().describe("The id from the person's application list this email is about, or null if none clearly fits"),
  eventAt: z.string().nullable().describe("ISO 8601 date-time of a scheduled interview, if the email states one"),
  action: z.object({
    needed: z.boolean().describe("True if the email asks the person to do something"),
    type: z.enum(ACTION_TYPES).nullable(),
    text: z.string().nullable().describe("What to do, imperative, under 12 words, e.g. 'Reply with your availability for a recruiter call'"),
    dueAt: z.string().nullable().describe("ISO 8601 date or date-time of a stated deadline"),
  }),
  summary: z.string().describe("One sentence, under 20 words, saying what the email means for the application"),
  confidence: z.number().describe("0 to 1: how sure you are of kind, company and application together"),
});
export type EmailClassification = z.infer<typeof EmailClassificationSchema>;

/** Header on every email Job Companion sends, so mailbox sync never reads its own digests. */
export const JOB_COMPANION_HEADER = "X-Job-Companion";
