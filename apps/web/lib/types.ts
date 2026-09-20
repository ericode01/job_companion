import type { ApplicationStatus } from "@jd/core/shared";

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  saved: "Saved",
  applying: "Applying",
  applied: "Applied",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export interface TaskStatus {
  status: "idle" | "queued" | "running" | "done" | "failed";
  error?: string | null;
}

export async function setApplicationStatus(jobId: number, status: ApplicationStatus | null, searchId?: number | null) {
  const res = await fetch("/api/applications", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobId, status, searchId: searchId ?? null }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "Could not update tracker");
  return res.json();
}
