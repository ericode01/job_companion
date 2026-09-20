import type { ActionType, ApplicationSource, ApplicationStatus, Comp, EmailKind, InterviewRound, ReviewState, StatusEventSource } from "@jd/core/shared";

/* JSON shapes of the pipeline APIs, as the browser receives them (dates are strings). */

export interface RoundJson {
  round: InterviewRound;
  label: string | null;
  state: "scheduling" | "scheduled" | "done";
  eventAt: string | null;
  emailIds: number[];
}

export interface PipelineCard {
  id: number;
  jobId: number | null;
  searchId: number | null;
  status: ApplicationStatus;
  source: ApplicationSource;
  title: string;
  companyName: string;
  locations: string[];
  comp: Comp | null;
  closedAt: string | null;
  updatedAt: string;
  appliedAt: string | null;
  confirmedAt: string | null;
  jobUrl: string | null;
  fitScore: number | null;
  emailCount: number;
  openActions: number;
  rounds: RoundJson[];
  lastEmailAt: string | null;
}

export interface ActionJson {
  emailId: number;
  applicationId: number;
  searchId: number | null;
  company: string;
  title: string;
  actionType: ActionType | null;
  actionText: string;
  actionDueAt: string | null;
  receivedAt: string;
  subject: string | null;
  fromName: string | null;
  fromAddress: string | null;
  webLink: string | null;
  rfcMessageId: string | null;
}

export interface ReviewJson {
  emailId: number;
  kind: EmailKind;
  round: InterviewRound | null;
  companyName: string | null;
  jobTitle: string | null;
  summary: string | null;
  subject: string | null;
  fromName: string | null;
  fromAddress: string | null;
  receivedAt: string;
  webLink: string | null;
  rfcMessageId: string | null;
  applicationId: number | null;
  searchId: number | null;
  classifiedBy: "llm" | "rules" | null;
  actionText: string | null;
}

export interface ChangeJson {
  eventId: number;
  applicationId: number;
  searchId: number | null;
  company: string;
  title: string;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  createdAt: string;
}

/** A job search, as the pipeline's filter chips show it. */
export interface SearchTag {
  id: number;
  name: string;
  archived: boolean;
}

export interface PipelineData {
  cards: PipelineCard[];
  searches: SearchTag[];
  actions: ActionJson[];
  review: ReviewJson[];
  changes: ChangeJson[];
  mailbox: { connected: boolean; needsReauth: boolean };
}

export interface EmailJson {
  id: number;
  rfcMessageId: string | null;
  threadId: string | null;
  webLink: string | null;
  fromName: string | null;
  fromAddress: string | null;
  subject: string | null;
  receivedAt: string;
  snippet: string | null;
  kind: EmailKind;
  round: InterviewRound | null;
  roundLabel: string | null;
  eventAt: string | null;
  companyName: string | null;
  jobTitle: string | null;
  summary: string | null;
  confidence: number | null;
  classifiedBy: "llm" | "rules" | null;
  applicationId: number | null;
  actionNeeded: boolean;
  actionType: ActionType | null;
  actionText: string | null;
  actionDueAt: string | null;
  actionDoneAt: string | null;
  reviewState: ReviewState;
}

export interface EventJson {
  id: number;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  source: StatusEventSource;
  emailId: number | null;
  revertedAt: string | null;
  createdAt: string;
}

export interface PanelData {
  app: {
    id: number;
    status: ApplicationStatus;
    source: ApplicationSource;
    jobId: number | null;
    searchId: number | null;
    title: string;
    companyName: string;
    postingUrl: string | null;
    locations: string[];
    comp: Comp | null;
    closedAt: string | null;
    appliedAt: string | null;
    confirmedAt: string | null;
    notes: string | null;
  };
  emails: EmailJson[];
  rounds: RoundJson[];
  events: EventJson[];
  dashboards: { id: number; name: string }[];
}

/** An email decision, sent to PATCH /api/mail/emails/:id. */
export async function emailAction(emailId: number, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`/api/mail/emails/${emailId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "That didn't save.");
}
