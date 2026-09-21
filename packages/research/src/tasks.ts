import { claimTask, completeTask, enqueueTask, failTask, getSettings, hasRunnableTasks, requeueInterruptedTasks, runAs, type Task } from "@jd/core";
import type { TaskKind } from "@jd/core/schema";
import { getDb, one, schema } from "@jd/core/db";
import { BudgetExceededError, describeLlmError, hasApiKey, isRetryableLlmError, LlmUnavailableError } from "@jd/llm";
import { and, eq, inArray } from "drizzle-orm";
import { getCompanyProfile, isProfileStale, researchCompany } from "./company";
import { discoverCompanies, startDiscoveryRun } from "./discover";
import { generateCoverLetter } from "./cover-letter";
import { scoreFit } from "./fit";
import { analyzeJob, getJobAnalysis } from "./job";
import { currentMasterResume, markResumeParseFailed, parseResume } from "./resume";
import { tailorResume } from "./tailor";

export type TaskHandler = (payload: Record<string, unknown>, opts: { background: boolean }) => Promise<unknown>;

/**
 * Handlers for this package's tasks. Other packages register theirs with registerTaskHandler
 * (mailbox sync lives in @jd/mail, which depends on packages that depend on this one).
 */
const HANDLERS: Partial<Record<TaskKind, TaskHandler>> = {
  parse_resume: (p, o) => parseResume(Number(p.resumeId), o),
  research_company: (p, o) => researchCompany(Number(p.companyId), { ...o, reuseNotes: p.reuseNotes !== false }),
  analyze_job: (p, o) => analyzeJob(Number(p.jobId), o),
  score_fit: (p, o) => scoreFit(Number(p.jobId), Number(p.resumeId), o),
  cover_letter: (p, o) => generateCoverLetter(Number(p.applicationId), o),
  tailor_resume: (p, o) => tailorResume(Number(p.userId), Number(p.jobId), o),
  discover_companies: (p, o) => discoverCompanies(Number(p.runId), o),
};

export function registerTaskHandler(kind: TaskKind, handler: TaskHandler): void {
  HANDLERS[kind] = handler;
}

/** Parallel slots per group. Research is slow and uses web search; the rest are quick Haiku calls. */
const LANES: { kinds: TaskKind[]; slots: number }[] = [
  // Both spend a long time in web search and then walk real career sites.
  { kinds: ["research_company", "discover_companies"], slots: 2 },
  { kinds: ["parse_resume", "analyze_job", "score_fit", "cover_letter", "tailor_resume"], slots: 4 },
  // Mostly waiting on mail servers; kept apart so a slow mailbox can't hold up fit scores.
  { kinds: ["sync_mailbox"], slots: 2 },
];

const MAX_ATTEMPTS = 3;

/** Hard limit per task so a stalled request can't hold a worker slot forever. */
const TIMEOUT_MS: Record<TaskKind, number> = {
  research_company: 8 * 60_000,
  parse_resume: 3 * 60_000,
  analyze_job: 2 * 60_000,
  score_fit: 2 * 60_000,
  cover_letter: 3 * 60_000,
  tailor_resume: 4 * 60_000,
  discover_companies: 10 * 60_000,
  sync_mailbox: 10 * 60_000,
};

export class TaskTimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TaskTimeoutError(`Timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/* ---------------- enqueue helpers ---------------- */

/*
 * Every payload carries the userId the work is for (null for shared/system work), so the
 * worker can attribute AI spend and apply that person's budget.
 */

export async function enqueueResumeParse(userId: number, resumeId: number) {
  return await enqueueTask("parse_resume", `resume:${resumeId}`, { userId, resumeId }, { background: false, priority: 20 });
}

export async function enqueueTailorResume(userId: number, jobId: number) {
  return await enqueueTask("tailor_resume", tailorKey(userId, jobId), { userId, jobId }, { background: false, priority: 20 });
}

export const tailorKey = (userId: number, jobId: number) => `tailor:${userId}:${jobId}`;

export async function enqueueCoverLetter(userId: number, applicationId: number) {
  return await enqueueTask("cover_letter", `application:${applicationId}`, { userId, applicationId }, { background: false, priority: 20 });
}

/** Kicks off a "find me more companies" run and returns its row so the UI can follow it. */
export async function enqueueDiscovery(prompt: string, trigger: "manual" | "schedule", searchId: number | null, startedBy: number | null = null) {
  const run = await startDiscoveryRun(prompt, trigger, searchId, startedBy);
  await enqueueTask("discover_companies", `discovery:${run.id}`, { userId: startedBy, runId: run.id }, { background: trigger === "schedule" });
  kickWorker();
  return run;
}

/** fresh: ignore cached notes (explicit Refresh). Retries after a failure reuse notes by default. */
export async function enqueueCompanyResearch(companyId: number, background: boolean, fresh = false, userId: number | null = null) {
  return await enqueueTask("research_company", `company:${companyId}`, { userId, companyId, reuseNotes: !fresh }, { background });
}

/**
 * Called when you open a job: analysis always, research if enabled and stale, fit if a parsed resume exists.
 * No-ops without an API key.
 */
export async function prepareJob(userId: number, jobId: number): Promise<void> {
  if (!hasApiKey()) return;
  const db = getDb();
  const j = await one(db.select({ companyId: schema.job.companyId, contentHash: schema.job.contentHash }).from(schema.job).where(eq(schema.job.id, jobId)));
  if (!j) return;
  const analysis = await getJobAnalysis(jobId);
  if (!analysis || analysis.contentHash !== j.contentHash) {
    await enqueueTask("analyze_job", `job:${jobId}`, { userId, jobId }, { background: false });
  }
  if ((await getSettings("research")).researchOnOpen && await isProfileStale(await getCompanyProfile(j.companyId))) {
    await enqueueCompanyResearch(j.companyId, false, false, userId);
  }
  await enqueueFitScores(userId, [jobId], false);
  kickWorker();
}

/** Queues fit scoring for jobs not yet scored against the current resume. */
export async function enqueueFitScores(userId: number, jobIds: number[], background: boolean): Promise<number> {
  if (!hasApiKey() || jobIds.length === 0) return 0;
  const resume = await currentMasterResume(userId);
  if (!resume || resume.parseStatus !== "done") return 0;
  const scored = new Set(
    (
      await getDb()
        .select({ jobId: schema.jobFit.jobId })
        .from(schema.jobFit)
        .where(and(eq(schema.jobFit.resumeHash, resume.sourceHash), inArray(schema.jobFit.jobId, jobIds)))
    ).map((r) => r.jobId),
  );
  let queued = 0;
  for (const jobId of jobIds) {
    if (scored.has(jobId)) continue;
    await enqueueTask("score_fit", `fit:${jobId}:${resume.sourceHash}`, { userId, jobId, resumeId: resume.id }, { background });
    queued++;
  }
  if (queued) kickWorker();
  return queued;
}

/* ---------------- worker ---------------- */

const g = globalThis as unknown as { __jdWorker?: { running: number[]; wake: () => void; started: boolean } };

async function runOne(t: Task): Promise<void> {
  const started = Date.now();
  const label = `[task ${t.id} ${t.kind} ${t.key}]`;
  console.log(`${label} start (attempt ${t.attempts})`);
  try {
    const userId = typeof t.payload.userId === "number" ? t.payload.userId : null;
    await withTimeout(
      runAs(userId, () => HANDLERS[t.kind]!(t.payload, { background: t.background })),
      TIMEOUT_MS[t.kind],
    );
    await completeTask(t.id);
    console.log(`${label} done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } catch (err) {
    const message = describeLlmError(err);
    console.warn(`${label} failed after ${((Date.now() - started) / 1000).toFixed(1)}s: ${message}`);
    if (err instanceof BudgetExceededError) {
      // Leave it queued; retry in an hour in case the cap was raised or the day rolled over.
      await failTask(t.id, message, new Date(Date.now() + 3_600_000));
    } else if (!(err instanceof LlmUnavailableError) && (isRetryableLlmError(err) || err instanceof TaskTimeoutError) && t.attempts < MAX_ATTEMPTS) {
      await failTask(t.id, message, new Date(Date.now() + 30_000 * 2 ** (t.attempts - 1)));
    } else {
      await failTask(t.id, message);
      if (t.kind === "parse_resume") await markResumeParseFailed(Number(t.payload.resumeId), message);
    }
  }
}

/**
 * Starts the worker in this process. It runs as its own process (scripts/worker.ts), not inside
 * the Next.js server: long streaming API calls stalled there, and dev reloads interrupt them.
 * Safe to call repeatedly.
 */
export async function startWorker(opts: { pollMs?: number } = {}): Promise<void> {
  if (g.__jdWorker?.started) return;
  await requeueInterruptedTasks();
  const state = { running: LANES.map(() => 0), wake: () => {}, started: true };
  g.__jdWorker = state;
  // Claiming a task is a query now, so fills can overlap: a task finishing and the poll both call
  // fill(). One claimer per lane keeps two of them from each seeing a free slot and over-claiming.
  const claiming = LANES.map(() => false);

  const fillLane = async (i: number) => {
    const lane = LANES[i]!;
    if (claiming[i]) return; // the fill in progress will claim; the poll catches anything it misses
    claiming[i] = true;
    try {
      // Only claim what this process can run (a CLI without the mail handler leaves syncs queued).
      const kinds = lane.kinds.filter((k) => HANDLERS[k]);
      while (state.running[i]! < lane.slots) {
        const t = await claimTask(kinds);
        if (!t) break;
        state.running[i]!++;
        void runOne(t).finally(() => {
          state.running[i]!--;
          fill();
        });
      }
    } catch (err) {
      console.warn(`[worker] couldn't claim a task: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      claiming[i] = false;
    }
  };
  const fill = () => LANES.forEach((_, i) => void fillLane(i));
  state.wake = fill;
  fill();
  // Picks up tasks enqueued by the web app and retries whose runAfter has passed.
  setInterval(() => {
    hasRunnableTasks().then(
      (runnable) => runnable && fill(),
      (err: unknown) => console.warn(`[worker] couldn't check the queue: ${err instanceof Error ? err.message : String(err)}`),
    );
  }, opts.pollMs ?? 1000);
}

/** Wakes a worker running in this process (CLI use). The web app relies on the worker process polling. */
export function kickWorker(): void {
  g.__jdWorker?.wake();
}

/* ---------------- status ---------------- */

export interface TaskStatus {
  status: "idle" | "queued" | "running" | "done" | "failed";
  error?: string | null;
}

export async function taskStatus(kind: TaskKind, key: string): Promise<TaskStatus> {
  const row = (
    await getDb()
      .select({ status: schema.task.status, error: schema.task.error })
      .from(schema.task)
      .where(and(eq(schema.task.kind, kind), eq(schema.task.key, key)))
      .orderBy(schema.task.id)
  ).at(-1);
  return row ? { status: row.status, error: row.error } : { status: "idle" };
}
