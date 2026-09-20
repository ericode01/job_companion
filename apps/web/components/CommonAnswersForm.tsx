"use client";

import { CheckCircle2, ChevronDown } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Alert, Skeleton } from "@/components/ui";

type Category = "work_auth" | "sponsorship" | "relocation" | "salary" | "eeo" | "logistics" | "custom";

interface Question {
  /** The canonical wording saved to your answers; form variants are matched to it later. */
  question: string;
  category: Category;
  kind: "yesno" | "choice" | "text";
  options?: string[];
  placeholder?: string;
  hint?: string;
  defaultAnswer?: string;
}

const DECLINE = "Decline to self-identify";

/** The questions nearly every application asks. Wording matches the starting answers in @jd/apply. */
const COMMON: Question[] = [
  { question: "Are you legally authorized to work in the United States?", category: "work_auth", kind: "yesno" },
  { question: "Will you now or in the future require visa sponsorship?", category: "sponsorship", kind: "yesno" },
  { question: "Are you willing to relocate?", category: "relocation", kind: "choice", options: ["Yes", "No", "Open to discussing"] },
  {
    question: "What are your salary expectations?",
    category: "salary",
    kind: "text",
    placeholder: "e.g. $250,000–$290,000 base, flexible for the right role",
    hint: "Leave blank to be asked each time; salary is often best answered per job.",
  },
  { question: "When can you start?", category: "logistics", kind: "text", placeholder: "e.g. Two weeks after an offer" },
  { question: "How did you hear about this position?", category: "logistics", kind: "text", defaultAnswer: "Company website" },
];

const EEO: Question[] = [
  { question: "Gender", category: "eeo", kind: "text" },
  { question: "Race / ethnicity", category: "eeo", kind: "text" },
  { question: "Are you Hispanic or Latino?", category: "eeo", kind: "text" },
  { question: "Veteran status", category: "eeo", kind: "text" },
  { question: "Disability status", category: "eeo", kind: "text" },
];

const CONTACT = [
  { key: "phone", label: "Phone", type: "tel", autoComplete: "tel" },
  { key: "location", label: "Where you live", type: "text", autoComplete: "address-level2", placeholder: "New York, NY" },
  { key: "linkedin", label: "LinkedIn URL", type: "url", autoComplete: "url" },
] as const;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Answer the usual application questions once. Saved answers fill forms through the
 * extension; anything left blank is asked the first time a form needs it.
 */
export function CommonAnswersForm({ onSaved, saveLabel = "Save answers" }: { onSaved?: () => void; saveLabel?: string }) {
  const baseId = useId();
  const [answers, setAnswers] = useState<Record<string, string> | null>(null);
  const [contact, setContact] = useState<Record<string, string>>({});
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [showEeo, setShowEeo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([fetch("/api/answers").then((r) => r.json()), fetch("/api/profile").then((r) => r.json())]).then(([a, p]) => {
      const existing = new Map<string, string>((a.answers as { question: string; answer: string; scope: string }[]).filter((x) => x.scope === "global").map((x) => [norm(x.question), x.answer]));
      const initial: Record<string, string> = {};
      for (const q of [...COMMON, ...EEO]) initial[q.question] = existing.get(norm(q.question)) ?? q.defaultAnswer ?? (q.category === "eeo" ? DECLINE : "");
      setAnswers(initial);
      setProfile(p);
      setContact({ phone: p.phone ?? "", location: p.location ?? "", linkedin: p.links?.linkedin ?? "" });
    });
  }, []);

  const set = (q: string, v: string) => {
    setAnswers((a) => ({ ...a!, [q]: v }));
    setSaved(false);
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!answers || !profile) return;
    setBusy(true);
    setError(null);
    const all = [...COMMON, ...EEO];
    const payload = all
      .map((q) => ({ question: q.question, category: q.category, answer: (answers[q.question] ?? "").trim() }))
      .filter((a) => a.answer);
    const links = { ...((profile.links as Record<string, string>) ?? {}), linkedin: contact.linkedin?.trim() || undefined };
    const [r1, r2] = await Promise.all([
      fetch("/api/answers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }),
      fetch("/api/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: contact.phone, location: contact.location, links }),
      }),
    ]);
    setBusy(false);
    if (!r1.ok || !r2.ok) {
      setError(((await (r1.ok ? r2 : r1).json()) as { error?: string }).error ?? "Couldn't save. Check the fields and try again.");
      return;
    }
    setSaved(true);
    onSaved?.();
  }

  if (!answers) return <Skeleton className="h-96" />;

  const field = (q: Question, i: number) => {
    const id = `${baseId}-${i}`;
    const value = answers[q.question] ?? "";
    if (q.kind === "yesno" || q.kind === "choice") {
      const options = q.options ?? ["Yes", "No"];
      return (
        <fieldset key={q.question} className="space-y-1.5">
          <legend className="text-sm font-medium">{q.question}</legend>
          <div className="flex flex-wrap gap-2">
            {options.map((o) => (
              <label
                key={o}
                className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm transition-colors ${
                  value === o ? "border-accent bg-accent-soft font-medium text-accent" : "border-border bg-surface hover:border-border-strong"
                }`}
              >
                <input type="radio" name={id} className="sr-only" checked={value === o} onChange={() => set(q.question, o)} />
                {o}
              </label>
            ))}
          </div>
        </fieldset>
      );
    }
    return (
      <div key={q.question}>
        <label htmlFor={id} className="mb-1 block text-sm font-medium">
          {q.question}
        </label>
        <input id={id} className="input" value={value} placeholder={q.placeholder} onChange={(e) => set(q.question, e.target.value)} aria-describedby={q.hint ? `${id}-h` : undefined} />
        {q.hint && (
          <p id={`${id}-h`} className="helper">
            {q.hint}
          </p>
        )}
      </div>
    );
  };

  return (
    <form onSubmit={save} className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}

      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-semibold">Contact details forms ask for</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {CONTACT.map((c) => (
            <div key={c.key}>
              <label htmlFor={`${baseId}-${c.key}`} className="label">
                {c.label}
              </label>
              <input
                id={`${baseId}-${c.key}`}
                className="input"
                type={c.type}
                autoComplete={c.autoComplete}
                placeholder={"placeholder" in c ? c.placeholder : undefined}
                value={contact[c.key] ?? ""}
                onChange={(e) => {
                  setContact((x) => ({ ...x, [c.key]: e.target.value }));
                  setSaved(false);
                }}
              />
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-2 text-sm font-semibold">Questions on almost every application</legend>
        {COMMON.map(field)}
      </fieldset>

      <div className="rounded-lg border border-border">
        <button type="button" className="flex min-h-11 w-full items-center justify-between px-3 text-left text-sm font-semibold" aria-expanded={showEeo} onClick={() => setShowEeo((s) => !s)}>
          <span>
            Voluntary demographic questions{" "}
            <span className="font-normal text-muted">— set to &ldquo;{DECLINE}&rdquo; unless you change them</span>
          </span>
          <ChevronDown aria-hidden className={`size-4 shrink-0 transition-transform ${showEeo ? "rotate-180" : ""}`} />
        </button>
        {showEeo && (
          <div className="space-y-3 border-t border-border p-3">
            <p className="text-xs text-muted">Answers are matched to each form&apos;s own options. Use the wording you&apos;d pick, e.g. &ldquo;Woman&rdquo; or &ldquo;Not a veteran&rdquo;.</p>
            {EEO.map((q, i) => field(q, COMMON.length + i))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-3">
        <span role="status" className="text-sm">
          {saved && (
            <span className="inline-flex items-center gap-1 text-good">
              <CheckCircle2 aria-hidden className="size-4" /> Saved
            </span>
          )}
        </span>
        <button className="btn-primary" disabled={busy}>
          {busy ? "Saving…" : saveLabel}
        </button>
      </div>
    </form>
  );
}
