import { z } from "zod";

/* ---------- Resume ---------- */

export const ResumeBulletSchema = z.object({
  id: z.string().describe("Stable id like 'e1b3' (experience 1, bullet 3)"),
  text: z.string(),
});

export const ResumeSourceSchema = z.object({
  contact: z.object({
    name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    location: z.string().nullable(),
    links: z.array(z.string()).describe("Full URLs or handles as written (LinkedIn, GitHub, site)"),
  }),
  summary: z.string().nullable(),
  experience: z.array(
    z.object({
      id: z.string().describe("Stable id like 'e1'"),
      company: z.string(),
      title: z.string(),
      location: z.string().nullable(),
      start: z.string().nullable().describe("As written, e.g. 'Mar 2021'"),
      end: z.string().nullable().describe("As written, or 'Present'"),
      bullets: z.array(ResumeBulletSchema),
    }),
  ),
  education: z.array(
    z.object({
      school: z.string(),
      degree: z.string().nullable(),
      field: z.string().nullable(),
      start: z.string().nullable(),
      end: z.string().nullable(),
      details: z.array(z.string()).describe("GPA, honors, minors, coursework, activities, as written"),
    }),
  ),
  skills: z.array(z.object({ category: z.string().nullable(), items: z.array(z.string()) })),
  projects: z.array(z.object({ name: z.string(), description: z.string().nullable(), bullets: z.array(ResumeBulletSchema) })),
  certifications: z.array(z.string()),
  additional: z
    .array(z.object({ heading: z.string(), items: z.array(z.string()) }))
    .describe("Any other section (entrepreneurial experience, awards, publications, volunteering, languages), with its original heading"),
});
export type ResumeSource = z.infer<typeof ResumeSourceSchema>;

/** What the model reports; `before` is filled in from the master resume, so it isn't echoed back. */
export const ResumeChangeReportSchema = z.object({
  section: z.string().describe("'Summary', 'Skills', or the role the bullet belongs to"),
  sourceId: z.string().nullable().describe("id of the master bullet this refers to, or null for summary/skills"),
  after: z.string().nullable().describe("new text, or null when the item was dropped"),
  reason: z.string().describe("why this helps for this job, at most 12 words"),
});
export type ResumeChangeReport = z.infer<typeof ResumeChangeReportSchema>;

export interface ResumeChange {
  section: string;
  before: string | null;
  after: string | null;
  reason: string;
}

export const TailoredResumeSchema = z.object({
  summary: z.string().nullable().describe("Rewritten professional summary, or null to drop it"),
  experience: z.array(
    z.object({
      id: z.string().describe("id of the role from the master resume"),
      bullets: z.array(
        z.object({
          sourceId: z.string().describe("id of the master bullet this came from"),
          text: z.string().describe("the bullet, reworded or unchanged"),
        }),
      ),
    }),
  ),
  skills: z.array(z.object({ category: z.string().nullable(), items: z.array(z.string()) })).describe("Re-ordered skills; only skills from the master resume"),
  changes: z.array(ResumeChangeReportSchema).describe("At most 15 entries, the ones that matter most"),
});
export type TailoredResume = z.infer<typeof TailoredResumeSchema>;

/* ---------- Company research ---------- */

const Sourced = <T extends z.ZodType>(value: T) =>
  z.object({
    value: value.nullable(),
    sourceUrl: z.string().nullable().describe("URL the value came from; null if value is null"),
  });

export const CompanyProfileSchema = z.object({
  overview: z.string().nullable().describe("2–4 sentences: what the company does and for whom"),
  products: z.array(z.object({ name: z.string(), description: z.string(), sourceUrl: z.string().nullable() })),
  customers: Sourced(z.string()).describe("Customer segments or notable customers"),
  businessModel: Sourced(z.string()),
  competitors: z.array(z.string()),
  founded: Sourced(z.string()).describe("Year"),
  headquarters: Sourced(z.string()),
  headcount: Sourced(z.string()).describe("Range or approximate figure with as-of date, e.g. '~1,200 (2026)'"),
  stage: Sourced(z.enum(["pre-seed", "seed", "series-a", "series-b", "series-c", "series-d-plus", "growth", "public", "acquired", "bootstrapped", "unknown"])),
  totalFunding: Sourced(z.string()).describe("e.g. '$1.2B'"),
  lastRound: Sourced(z.string()).describe("e.g. 'Series D, $300M, Jun 2025'"),
  investors: z.array(z.string()),
  publicTicker: z.string().nullable(),
  recentNews: z.array(z.object({ headline: z.string(), date: z.string().nullable(), sourceUrl: z.string() })),
  confidence: z.enum(["high", "medium", "low"]).describe("Overall confidence in funding/size figures"),
  notes: z.string().nullable().describe("Caveats, e.g. name collisions or conflicting figures"),
});
export type CompanyProfile = z.infer<typeof CompanyProfileSchema>;

/* ---------- Job analysis ---------- */

export const JobAnalysisSchema = z.object({
  summary: z.string().describe("One sentence: what this person will do"),
  level: z.string().nullable().describe("e.g. 'Staff', 'Senior'; null if unclear"),
  team: z.string().nullable(),
  techStack: z.array(z.string()).describe("Languages, frameworks, infra named in the posting"),
  mustHave: z.array(z.string()).describe("Required qualifications, short phrases"),
  niceToHave: z.array(z.string()),
  minYearsExperience: z.number().nullable(),
  workplacePolicy: z.string().nullable().describe("e.g. 'Hybrid, 3 days/week in NYC office'"),
  visaSponsorship: z.enum(["offered", "not_offered", "unspecified"]),
  compensation: z
    .object({ min: z.number().nullable(), max: z.number().nullable(), currency: z.string().nullable(), note: z.string().nullable() })
    .nullable()
    .describe("Only if stated in the posting"),
});
export type JobAnalysis = z.infer<typeof JobAnalysisSchema>;

/* ---------- Fit ---------- */

export const FitResultSchema = z.object({
  score: z.number().describe("0–100 integer"),
  verdict: z.enum(["strong", "good", "stretch", "weak"]),
  summary: z.string().describe("One or two sentences"),
  strengths: z.array(z.object({ point: z.string(), evidence: z.string().describe("Short quote or paraphrase from the resume") })),
  gaps: z.array(z.string()),
  talkingPoints: z.array(z.string()).describe("What to emphasize in the application or interview"),
});
export type FitResult = z.infer<typeof FitResultSchema>;

export const APPLICATION_STATUSES = ["saved", "applying", "applied", "interview", "offer", "rejected", "withdrawn"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/* ---------- Apply (shared with the Chrome extension) ---------- */

export type QuestionKind = "text" | "textarea" | "select" | "multiselect" | "radio" | "checkbox" | "boolean" | "file" | "number" | "date";

/** A form question the extension could not fill from the profile alone. */
export interface FormQuestion {
  index: number;
  label: string;
  kind: QuestionKind;
  required: boolean;
  options: string[];
  description?: string | null;
}

export type AnswerSource = "bank" | "rule" | "profile" | "ai_draft" | "ai_derived" | "none";

export interface QuestionAnswer {
  index: number;
  /** A string for text/single choice, string[] for multi choice, null to leave blank. */
  value: string | string[] | null;
  source: AnswerSource;
  /** filled: safe to use; review: filled but please check; needs_user: left blank on purpose. */
  status: "filled" | "review" | "needs_user";
  category: "work_auth" | "sponsorship" | "relocation" | "salary" | "eeo" | "logistics" | "custom";
  note: string | null;
  bankId: number | null;
  /** Recurring questions can be saved to the answer bank; job-specific drafts can't. */
  saveable: boolean;
}
