import { STAGE_RANK } from "@jd/apply";
import type { ApplicationStatus, EmailKind } from "@jd/core";

/** The status an email of this kind implies for a new application found only in email. */
export function statusForNew(kind: EmailKind): ApplicationStatus | null {
  switch (kind) {
    case "application_received":
      return "applied";
    case "interview_request":
    case "interview_scheduled":
    case "interview_update":
    case "assessment":
      return "interview";
    case "rejection":
      return "rejected";
    case "offer":
      return "offer";
    default:
      return null;
  }
}

export interface Decision {
  /** Move the card here. */
  move: ApplicationStatus | null;
  /** Record the confirmation (shows ✓ Confirmed). */
  confirm: boolean;
  /** Ask the person instead of acting; the reason is shown to them. */
  review: string | null;
}

const CLOSED = new Set<ApplicationStatus>(["rejected", "withdrawn"]);

/**
 * What an email does to an application it's linked to. Moves only go forward; a rejection
 * ends any stage but an offer; anything contradicting a closed application is asked about; and
 * a card the person moved after the email arrived is left alone.
 */
export function decide(
  app: { status: ApplicationStatus; confirmedAt: Date | null },
  email: { kind: EmailKind; receivedAt: Date; confidence: number; classifiedBy: "llm" | "rules" },
  ctx: { lastManualMove: Date | null; threshold: number; confirmedByPerson?: boolean },
): Decision {
  const none: Decision = { move: null, confirm: false, review: null };
  if (!ctx.confirmedByPerson) {
    if (email.classifiedBy === "rules") return { ...none, review: "Sorted without AI, so please check it." };
    if (email.confidence < ctx.threshold) return { ...none, review: "I'm not sure what this email means for this application." };
  }
  // Asking the person settles it; otherwise a card they moved after this email arrived stays put.
  const manualWins = !ctx.confirmedByPerson && Boolean(ctx.lastManualMove && ctx.lastManualMove > email.receivedAt);
  const rank = STAGE_RANK[app.status];
  const go = (to: ApplicationStatus, confirm = false): Decision => ({ move: manualWins ? null : to, confirm, review: null });

  switch (email.kind) {
    case "application_received":
      return { move: !manualWins && rank < STAGE_RANK.applied ? "applied" : null, confirm: !app.confirmedAt, review: null };
    case "interview_request":
    case "interview_scheduled":
    case "interview_update":
    case "assessment":
      if (CLOSED.has(app.status)) return { ...none, review: "This email suggests the process is still going, but the application is closed." };
      return rank < STAGE_RANK.interview ? go("interview") : none;
    case "rejection":
      if (app.status === "offer") return { ...none, review: "A rejection arrived for an application with an offer." };
      return CLOSED.has(app.status) ? none : go("rejected");
    case "offer":
      if (CLOSED.has(app.status)) return { ...none, review: "An offer arrived for an application marked closed." };
      return app.status === "offer" ? none : go("offer");
    default:
      return none;
  }
}
