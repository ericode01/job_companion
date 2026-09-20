import { appOrigin } from "@jd/core";
import type { ApplicationStatus, Comp } from "@jd/core";
import type { ActionItem, EmailChange } from "@jd/mail";
import type { Digest, DigestJob } from "./build";

const STATUS: Record<ApplicationStatus, string> = {
  saved: "Saved",
  applying: "Applying",
  applied: "Applied",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

const appLink = (a: { applicationId: number }) => `${appOrigin()}/pipeline?app=${a.applicationId}`;

const dueText = (a: ActionItem, timeZone: string) =>
  a.actionDueAt ? ` (due ${a.actionDueAt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone })})` : "";

const changeText = (c: EmailChange) =>
  c.fromStatus === null ? `added as ${STATUS[c.toStatus]}` : `${STATUS[c.fromStatus]} → ${STATUS[c.toStatus]}`;
function money(comp: Comp | null): string {
  if (!comp || (comp.min === null && comp.max === null)) return "";
  const k = (n: number | null) => (n === null ? "?" : `${Math.round(n / 1000)}k`);
  const cur = !comp.currency || comp.currency === "USD" ? "$" : `${comp.currency} `;
  return comp.interval === "hour" ? `${cur}${comp.min ?? "?"}–${comp.max ?? "?"}/hr` : `${cur}${k(comp.min)}–${k(comp.max)}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function subjectFor(digest: Digest): string {
  const replies = digest.actions.length;
  const matches = digest.total ? `${digest.total} new ${digest.total === 1 ? "match" : "matches"}` : "";
  if (replies) {
    return [`${replies} ${replies === 1 ? "email needs" : "emails need"} your reply (${digest.actions[0]!.company})`, matches].filter(Boolean).join(" · ").slice(0, 120);
  }
  if (digest.total === 0) return digest.changes.length ? "Job Companion: your pipeline was updated from email" : "Job Companion: no new matches";
  const top = digest.sections.flatMap((s) => s.jobs).sort((a, b) => (b.fitScore ?? -1) - (a.fitScore ?? -1))[0]!;
  return `${matches} · ${top.companyName} ${top.title}`.slice(0, 120);
}

const line = (j: DigestJob) =>
  [j.companyName, j.locations.slice(0, 2).join(" / ") || "Location not listed", money(j.comp), j.matchReason === "remote_us" ? "Remote (US)" : ""]
    .filter(Boolean)
    .join(" · ");

export function renderText(digest: Digest): string {
  const out: string[] = [];
  if (digest.actions.length) {
    out.push("## Needs your reply");
    for (const a of digest.actions) {
      out.push(`- ${a.company}: ${a.actionText}${dueText(a, digest.timeZone)}`, `   ${a.title}`);
      if (a.webLink) out.push(`   Open the email: ${a.webLink}`);
      out.push(`   ${appLink(a)}`);
    }
    out.push("");
  }
  if (digest.changes.length) {
    out.push("## Your pipeline, updated from email");
    for (const c of digest.changes.slice(0, 12)) out.push(`- ${c.company}, ${c.title}: ${changeText(c)}`);
    out.push("");
  }
  out.push(`${digest.total} new ${digest.total === 1 ? "job" : "jobs"} since ${digest.since.toLocaleString()}`, "");
  for (const s of digest.sections) {
    out.push(`## ${s.query}`);
    for (const j of s.jobs) {
      out.push(`${j.fitScore !== null ? `[Fit ${j.fitScore}] ` : ""}${j.title}`);
      out.push(`   ${line(j)}`);
      if (j.fitSummary) out.push(`   ${j.fitSummary}`);
      out.push(`   ${appOrigin()}/jobs/${j.jobId}?d=${s.searchId}`);
    }
    if (s.belowThreshold) out.push(`(${s.belowThreshold} more below your minimum fit score of ${s.minFitScore})`);
    out.push("");
  }
  if (digest.pendingQuestions) out.push(`${digest.pendingQuestions} question(s) waiting in your Answers inbox: ${appOrigin()}/answers`);
  if (!digest.resumeReady) out.push(`Upload your resume for fit scores: ${appOrigin()}/profile#resume`);
  return out.join("\n");
}

/** Table-based HTML with inline styles: what email clients actually render. */
export function renderHtml(digest: Digest): string {
  const card = (j: DigestJob, searchId: number) => `
    <tr><td style="padding:14px 0;border-bottom:1px solid #e2e8f0">
      <a href="${appOrigin()}/jobs/${j.jobId}?d=${searchId}" style="font:600 16px/1.3 -apple-system,Segoe UI,sans-serif;color:#18181b;text-decoration:none">${escapeHtml(j.title)}</a>
      <div style="font:400 14px/1.5 -apple-system,Segoe UI,sans-serif;color:#475569;margin-top:2px">${escapeHtml(line(j))}</div>
      ${j.fitSummary ? `<div style="font:400 13px/1.5 -apple-system,Segoe UI,sans-serif;color:#475569;margin-top:6px">${escapeHtml(j.fitSummary)}</div>` : ""}
      <div style="margin-top:8px">
        ${
          j.fitScore !== null
            ? `<span style="font:600 12px -apple-system,Segoe UI,sans-serif;background:${j.fitScore >= 85 ? "#e8f7ee;color:#15803d" : j.fitScore >= 70 ? "#eeeffe;color:#4f46e5" : "#fef3c7;color:#92400e"};padding:3px 8px;border-radius:999px">Fit ${j.fitScore}</span>`
            : ""
        }
        <a href="${appOrigin()}/jobs/${j.jobId}?d=${searchId}" style="font:600 12px -apple-system,Segoe UI,sans-serif;color:#4f46e5;text-decoration:none;margin-left:8px">Open in Job Companion →</a>
      </div>
    </td></tr>`;

  const sections = digest.sections
    .map(
      (s) => `
      <tr><td style="padding-top:22px">
        <div style="font:700 13px -apple-system,Segoe UI,sans-serif;color:#4f46e5;letter-spacing:.04em;text-transform:uppercase">${escapeHtml(s.query)}</div>
      </td></tr>
      ${s.jobs.map((j) => card(j, s.searchId)).join("")}
      ${s.belowThreshold ? `<tr><td style="padding:10px 0;font:400 12px -apple-system,Segoe UI,sans-serif;color:#475569">${s.belowThreshold} more below your minimum fit score of ${s.minFitScore}.</td></tr>` : ""}`,
    )
    .join("");

  const font = "-apple-system,Segoe UI,sans-serif";
  const actions = digest.actions.length
    ? `<tr><td style="padding-top:18px">
        <div style="border:1px solid #e2e8f0;border-left:4px solid #b45309;border-radius:10px;padding:12px 14px">
          <div style="font:700 13px ${font};color:#92400e;letter-spacing:.04em;text-transform:uppercase">Needs your reply</div>
          ${digest.actions
            .map(
              (a) => `<div style="padding:10px 0;border-bottom:1px solid #f1f5f9">
                <div style="font:600 15px/1.4 ${font};color:#18181b">${escapeHtml(a.company)}: ${escapeHtml(a.actionText)}<span style="color:#92400e;font-weight:600">${escapeHtml(dueText(a, digest.timeZone))}</span></div>
                <div style="font:400 13px/1.5 ${font};color:#475569">${escapeHtml(a.title)}</div>
                <div style="margin-top:4px;font:600 12px ${font}">
                  ${a.webLink ? `<a href="${escapeHtml(a.webLink)}" style="color:#4f46e5;text-decoration:none">Open the email →</a>&nbsp;&nbsp;` : ""}
                  <a href="${appLink(a)}" style="color:#4f46e5;text-decoration:none">See the application →</a>
                </div>
              </div>`,
            )
            .join("")}
        </div>
      </td></tr>`
    : "";
  const changes = digest.changes.length
    ? `<tr><td style="padding-top:18px">
        <div style="font:700 13px ${font};color:#4f46e5;letter-spacing:.04em;text-transform:uppercase">Your pipeline, updated from email</div>
        ${digest.changes
          .slice(0, 12)
          .map(
            (c) =>
              `<div style="padding:6px 0;font:400 14px/1.5 ${font};color:#18181b"><a href="${appLink(c)}" style="color:#18181b;text-decoration:none;font-weight:600">${escapeHtml(c.company)}</a> · ${escapeHtml(c.title)} <span style="color:#475569">— ${escapeHtml(changeText(c))}</span></div>`,
          )
          .join("")}
      </td></tr>`
    : "";
  const replies = digest.actions.length ? `${digest.actions.length} ${digest.actions.length === 1 ? "email needs" : "emails need"} your reply` : "";
  const matches = digest.total ? `${digest.total} new ${digest.total === 1 ? "match" : "matches"}` : "";
  const heading = [replies, matches].filter(Boolean).join(" · ") || "Your job search today";

  return `<!doctype html><html><body style="margin:0;background:#f8fafc;padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;padding:24px">
    <tr><td>
      <div style="font:700 20px/1.3 ${font};color:#18181b">${heading}</div>
      <div style="font:400 13px ${font};color:#475569;margin-top:4px">Since ${escapeHtml(digest.since.toLocaleString())}</div>
    </td></tr>
    ${actions}
    ${changes}
    ${sections}
    ${
      digest.pendingQuestions
        ? `<tr><td style="padding-top:20px"><div style="background:#fef3c7;color:#92400e;border-radius:10px;padding:10px 12px;font:400 13px -apple-system,Segoe UI,sans-serif">${digest.pendingQuestions} question(s) waiting in your <a href="${appOrigin()}/answers" style="color:#92400e">Answers inbox</a>.</div></td></tr>`
        : ""
    }
    ${
      !digest.resumeReady
        ? `<tr><td style="padding-top:12px"><div style="background:#eeeffe;color:#4f46e5;border-radius:10px;padding:10px 12px;font:400 13px -apple-system,Segoe UI,sans-serif"><a href="${appOrigin()}/profile#resume" style="color:#4f46e5">Upload your resume</a> to get fit scores in this email.</div></td></tr>`
        : ""
    }
    <tr><td style="padding-top:22px;font:400 12px -apple-system,Segoe UI,sans-serif;color:#94a3b8">
      Sent by Job Companion. Choose which searches are included on each one's Email digest tab, or change the time in <a href="${appOrigin()}/account#digest" style="color:#94a3b8">Account</a>.
    </td></tr>
  </table></body></html>`;
}
