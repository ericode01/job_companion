"use client";

import { CheckCircle2, ClipboardList, Inbox, ListChecks, Pencil, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { CommonAnswersForm } from "@/components/CommonAnswersForm";
import { Alert, ConfirmDialog, EmptyState, SkeletonList } from "@/components/ui";
import { timeAgo } from "@/lib/format";

type Category = "work_auth" | "sponsorship" | "relocation" | "salary" | "eeo" | "logistics" | "custom";
interface Answer {
  id: number;
  category: Category;
  question: string;
  answer: string;
  scope: "global" | "job";
  jobId: number | null;
  useCount: number;
  lastUsedAt: string | null;
}
interface InboxItem {
  id: number;
  question: string;
  kind: string;
  options: string[];
  category: Category;
  seenCount: number;
  lastJobId: number | null;
  updatedAt: string;
}

const CATEGORY_LABELS: Record<Category, string> = {
  work_auth: "Work authorization",
  sponsorship: "Sponsorship",
  relocation: "Relocation",
  salary: "Salary",
  eeo: "Demographics (EEO)",
  logistics: "Logistics",
  custom: "Other",
};
const ORDER: Category[] = ["work_auth", "sponsorship", "relocation", "salary", "logistics", "eeo", "custom"];

export default function AnswersPage() {
  const [data, setData] = useState<{ answers: Answer[]; inbox: InboxItem[] } | null>(null);
  const [tab, setTab] = useState<"common" | "inbox" | "saved">("inbox");
  const [adding, setAdding] = useState(false);
  const [toDelete, setToDelete] = useState<Answer | null>(null);
  const [announce, setAnnounce] = useState("");

  const load = useCallback(async () => {
    const d = await (await fetch("/api/answers")).json();
    setData(d);
    return d as { inbox: InboxItem[] };
  }, []);

  useEffect(() => {
    void load().then((d) => {
      if (d.inbox.length === 0) setTab("common");
    });
  }, [load]);

  if (!data) return <SkeletonList rows={6} />;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Answers</h1>
        <p className="text-sm text-muted">
          Shared by all your job searches and reused on every application. When a form asks something new that will come up again,
          it lands in the inbox so you only answer it once.
        </p>
      </div>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      <div role="tablist" aria-label="Answers" className="inline-flex max-w-full overflow-x-auto rounded-lg border border-border bg-surface p-0.5 text-sm whitespace-nowrap">
        {(
          [
            ["common", "Common questions", null, ClipboardList],
            ["inbox", `Inbox`, data.inbox.length, Inbox],
            ["saved", "All saved answers", data.answers.length, ListChecks],
          ] as const
        ).map(([key, label, count, Icon]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={`inline-flex min-h-9 items-center gap-2 rounded-md px-3 font-medium transition-colors ${tab === key ? "bg-accent-soft text-accent" : "text-muted hover:text-text"}`}
            onClick={() => setTab(key)}
          >
            <Icon aria-hidden className="size-4" /> {label}
            {count !== null && (
              <span className={`chip tabular-nums ${key === "inbox" && count > 0 ? "bg-warn-soft text-warn" : "bg-surface-2 text-muted"}`}>{count}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "common" ? (
        <section className="card p-5 sm:p-6" aria-label="Common questions">
          <CommonAnswersForm onSaved={() => void load()} />
        </section>
      ) : tab === "inbox" ? (
        data.inbox.length === 0 ? (
          <EmptyState title="Inbox is empty" icon={<CheckCircle2 className="size-5" />}>
            When an application asks something you haven&apos;t answered before (like salary expectations or relocation), it shows up here.
          </EmptyState>
        ) : (
          <>
          <p className="text-sm text-muted">
            <span className="font-medium text-text">
              {data.inbox.length} {data.inbox.length === 1 ? "question" : "questions"} to answer
            </span>{" "}
            · answered once, they fill themselves from then on. Skip any that don&apos;t apply.
          </p>
          <ul className="mt-3 space-y-3">
            {data.inbox.map((item, i) => (
              <InboxCard
                key={item.id}
                item={item}
                index={i}
                onDone={async (msg) => {
                  setAnnounce(msg);
                  await load();
                }}
              />
            ))}
          </ul>
          </>
        )
      ) : (
        <div className="space-y-5">
          <div className="flex justify-end">
            <button className="btn" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
              <Plus aria-hidden className="size-4" /> Add answer
            </button>
          </div>
          {adding && (
            <AnswerForm
              onCancel={() => setAdding(false)}
              onSaved={async () => {
                setAdding(false);
                setAnnounce("Answer saved");
                await load();
              }}
            />
          )}
          {ORDER.map((cat) => {
            const rows = data.answers.filter((a) => a.category === cat);
            if (!rows.length) return null;
            return (
              <section key={cat} aria-labelledby={`cat-${cat}`}>
                <h2 id={`cat-${cat}`} className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
                  {CATEGORY_LABELS[cat]}
                </h2>
                <ul className="card divide-y divide-border">
                  {rows.map((a) => (
                    <SavedRow key={a.id} a={a} onChanged={load} onDelete={() => setToDelete(a)} />
                  ))}
                </ul>
              </section>
            );
          })}
          <ConfirmDialog
            open={toDelete !== null}
            title="Delete this answer?"
            body={toDelete ? `“${toDelete.question}” won't be filled automatically anymore. The question returns to your inbox next time a form asks it.` : ""}
            confirmLabel="Delete"
            danger
            onCancel={() => setToDelete(null)}
            onConfirm={async () => {
              if (toDelete) await fetch(`/api/answers/${toDelete.id}`, { method: "DELETE" });
              setToDelete(null);
              setAnnounce("Answer deleted");
              await load();
            }}
          />
        </div>
      )}
    </div>
  );
}

function AnswerInput({ id, options, value, onChange, invalid, describedBy }: { id: string; options: string[]; value: string; onChange: (v: string) => void; invalid?: boolean; describedBy?: string }) {
  if (options.length) {
    return (
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid} aria-describedby={describedBy}>
        <option value="">Choose…</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  return <input id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid} aria-describedby={describedBy} />;
}

function InboxCard({ item, index, onDone }: { item: InboxItem; index: number; onDone: (msg: string) => Promise<void> }) {
  const id = useId();
  const [showFull, setShowFull] = useState(false);
  // A form's own wording can run to forty words; two lines is enough to recognise it.
  const long = item.question.length > 140;
  const [answer, setAnswer] = useState("");
  const [scope, setScope] = useState<"global" | "job">(item.category === "salary" ? "job" : "global");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!answer.trim()) {
      setError("Enter an answer, or ignore this question.");
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/answers/inbox/${item.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answer, scope }) });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).issues?.[0]?.message ?? "Couldn't save.");
      return;
    }
    await onDone("Answer saved");
    // Straight to the next one: this is a batch chore, and reaching for the mouse each time is slow.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-inbox-card="${index}"] textarea, [data-inbox-card="${index}"] input, [data-inbox-card="${index}"] select`)?.focus());
  }

  return (
    <li data-inbox-card={index} className="card space-y-3 p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className={`block font-semibold ${long && !showFull ? "line-clamp-2" : ""}`}>
            {item.question}
          </label>
          {long && (
            <button type="button" className="text-xs font-medium text-accent hover:underline" aria-expanded={showFull} onClick={() => setShowFull((v) => !v)}>
              {showFull ? "Show less" : "Show more"}
            </button>
          )}
          <p className="text-xs text-muted">
            {CATEGORY_LABELS[item.category]} · asked {item.seenCount} {item.seenCount === 1 ? "time" : "times"} · last asked {timeAgo(item.updatedAt)}
          </p>
        </div>
        <button
          className="btn-ghost"
          onClick={async () => {
            await fetch(`/api/answers/inbox/${item.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "ignored" }) });
            await onDone("Question ignored");
          }}
          aria-label={`Ignore “${item.question}”`}
          title="Ignore"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
      <AnswerInput id={id} options={item.options} value={answer} onChange={(v) => { setAnswer(v); setError(null); }} invalid={Boolean(error)} describedBy={error ? `${id}-err` : undefined} />
      {error && (
        <p id={`${id}-err`} className="field-error">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <fieldset className="flex flex-wrap gap-4 text-sm">
          <legend className="sr-only">Use this answer for</legend>
          <label className="flex items-center gap-2">
            <input type="radio" className="size-4 accent-[var(--accent)]" checked={scope === "global"} onChange={() => setScope("global")} /> All jobs
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" className="size-4 accent-[var(--accent)]" checked={scope === "job"} onChange={() => setScope("job")} disabled={!item.lastJobId} /> Only the job that asked
          </label>
        </fieldset>
        <button className="btn-primary" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : "Save answer"}
        </button>
      </div>
    </li>
  );
}

function SavedRow({ a, onChanged, onDelete }: { a: Answer; onChanged: () => Promise<unknown>; onDelete: () => void }) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(a.answer);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const res = await fetch(`/api/answers/${a.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ answer: value }) });
    if (!res.ok) {
      setError((await res.json()).issues?.[0]?.message ?? "Couldn't save.");
      return;
    }
    setEditing(false);
    await onChanged();
  }

  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{a.question}</p>
          {!editing && <p className="mt-0.5 text-sm text-text/90">{a.answer}</p>}
          <p className="mt-0.5 text-xs text-muted">
            {a.scope === "job" ? "One job only · " : ""}
            {a.useCount ? `Used ${a.useCount} ${a.useCount === 1 ? "time" : "times"}` : "Not used yet"}
          </p>
        </div>
        {!editing && (
          <div className="flex shrink-0 gap-1">
            <button className="btn-ghost" onClick={() => setEditing(true)} aria-label={`Edit answer to “${a.question}”`}>
              <Pencil aria-hidden className="size-4" />
            </button>
            <button className="btn-ghost hover:text-danger" onClick={onDelete} aria-label={`Delete answer to “${a.question}”`}>
              <Trash2 aria-hidden className="size-4" />
            </button>
          </div>
        )}
      </div>
      {editing && (
        <div className="mt-2 space-y-2">
          <label htmlFor={id} className="sr-only">
            Answer
          </label>
          <input id={id} className="input" value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={Boolean(error)} />
          {error && <p className="field-error">{error}</p>}
          <div className="flex justify-end gap-2">
            <button className="btn" onClick={() => { setEditing(false); setValue(a.answer); setError(null); }}>
              Cancel
            </button>
            <button className="btn-primary" onClick={() => void save()}>
              Save
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function AnswerForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => Promise<void> }) {
  const qId = useId();
  const aId = useId();
  const cId = useId();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [category, setCategory] = useState<Category>("custom");
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function save() {
    const res = await fetch("/api/answers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, answer, category }) });
    if (!res.ok) {
      const body = await res.json();
      setErrors(Object.fromEntries((body.issues ?? []).map((i: { path: string[]; message: string }) => [i.path.join("."), i.message])));
      return;
    }
    await onSaved();
  }

  return (
    <div className="card space-y-3 p-4">
      <div>
        <label htmlFor={qId} className="label">
          Question
        </label>
        <input id={qId} className="input" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Are you willing to relocate?" aria-invalid={Boolean(errors.question)} />
        {errors.question && <p className="field-error">{errors.question}</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <div>
          <label htmlFor={aId} className="label">
            Answer
          </label>
          <input id={aId} className="input" value={answer} onChange={(e) => setAnswer(e.target.value)} aria-invalid={Boolean(errors.answer)} />
          {errors.answer && <p className="field-error">{errors.answer}</p>}
        </div>
        <div>
          <label htmlFor={cId} className="label">
            Category
          </label>
          <select id={cId} className="input" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {ORDER.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {errors[""] && <Alert tone="danger">{errors[""]}</Alert>}
      <div className="flex justify-end gap-2">
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary" onClick={() => void save()}>
          Save answer
        </button>
      </div>
    </div>
  );
}
