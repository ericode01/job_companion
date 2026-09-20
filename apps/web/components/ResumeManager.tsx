"use client";

import type { ResumeSource } from "@jd/core/shared";
import { CheckCircle2, FileText, Plus, RotateCcw, Save, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, ConfirmDialog, EmptyState, SkeletonList, Spinner } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import type { TaskStatus } from "@/lib/types";

interface ResumeRow {
  id: number;
  fileName: string;
  parsedText: string;
  source: ResumeSource | null;
  parseStatus: "pending" | "done" | "failed" | "skipped";
  parseError: string | null;
  createdAt: string;
  updatedAt: string;
}
interface Data {
  current: ResumeRow | null;
  parseTask: TaskStatus | null;
  history: { id: number; fileName: string; createdAt: string; parseStatus: string }[];
  hasApiKey: boolean;
}

const lines = (s: string) =>
  s
    .split("\n")
    .map((l) => l.replace(/^\s*[-•]\s*/, "").trim())
    .filter(Boolean);

/** Reassigns stable ids in order so tailoring (M4) can trace every bullet back to this version. */
function renumber(s: ResumeSource): ResumeSource {
  return {
    ...s,
    experience: s.experience.map((e, i) => ({ ...e, id: `e${i + 1}`, bullets: e.bullets.map((b, j) => ({ ...b, id: `e${i + 1}b${j + 1}` })) })),
    projects: s.projects.map((p, i) => ({ ...p, bullets: p.bullets.map((b, j) => ({ ...b, id: `p${i + 1}b${j + 1}` })) })),
  };
}

/**
 * Your master resume: upload, reading status, and (outside onboarding) the editor for the
 * parsed sections. `compact` shows only the upload and a summary of what was read.
 */
export function ResumeManager({ compact = false, onChange }: { compact?: boolean; onChange?: (state: "none" | "reading" | "ready" | "failed") => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const d = (await (await fetch("/api/resume")).json()) as Data;
    setData(d);
    const st = d.current?.parseStatus;
    onChange?.(!d.current ? "none" : st === "pending" ? "reading" : st === "done" ? "ready" : "failed");
    return d;
  }, [onChange]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const d = await load();
      if (d.current?.parseStatus === "pending") timer = setTimeout(tick, 3000);
    };
    void tick();
    return () => clearTimeout(timer);
  }, [load]);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/resume", { method: "POST", body: form });
    const body = await res.json();
    setUploading(false);
    if (!res.ok) {
      setError(body.error ?? "Upload failed");
      return;
    }
    const poll = async () => {
      const d = await load();
      if (d.current?.parseStatus === "pending") setTimeout(poll, 3000);
    };
    void poll();
  }

  async function reparse(id: number) {
    const res = await fetch(`/api/resume/${id}/parse`, { method: "POST" });
    if (!res.ok) {
      setError((await res.json()).error);
      return;
    }
    const poll = async () => {
      const d = await load();
      if (d.current?.parseStatus === "pending") setTimeout(poll, 3000);
    };
    void poll();
  }

  if (!data) return <SkeletonList rows={4} />;
  const cur = data.current;

  const picker = (
    <input
      ref={fileInput}
      type="file"
      accept="application/pdf"
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) void upload(f);
        e.target.value = "";
      }}
    />
  );

  return (
    <div className="space-y-4">
      {picker}
      {cur && (
        <div className="flex justify-end">
          <button className="btn" onClick={() => fileInput.current?.click()} disabled={uploading}>
            <Upload aria-hidden className="size-4" />
            {uploading ? "Uploading…" : "Replace with a new PDF"}
          </button>
        </div>
      )}
      {error && <Alert tone="danger">{error}</Alert>}

      {!cur ? (
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files[0];
            if (f) void upload(f);
          }}
          disabled={uploading}
          className={`flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
            dragOver ? "border-accent bg-accent-soft" : "border-border-strong bg-surface hover:border-accent"
          }`}
        >
          <span aria-hidden className="rounded-full bg-accent-soft p-3 text-accent">
            <Upload className="size-5" />
          </span>
          <span className="font-semibold">{uploading ? "Uploading…" : "Drop your resume PDF here, or click to choose"}</span>
          <span className="max-w-md text-sm text-muted">
            It&apos;s stored in your account. Its text is sent to the Claude API once to split it into sections you can check.
          </span>
        </button>
      ) : (
        <>
          <div className="card flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
            <FileText aria-hidden className="size-4 text-muted" />
            <span className="font-medium">{cur.fileName}</span>
            <span className="text-muted">uploaded {timeAgo(cur.createdAt)}</span>
            <span className="ml-auto">
              {cur.parseStatus === "pending" && <Spinner label="Reading your resume… (about a minute)" />}
              {cur.parseStatus === "done" && (
                <span className="inline-flex items-center gap-1 text-good">
                  <CheckCircle2 aria-hidden className="size-4" /> {compact ? "Read successfully" : "Read. Check and correct below."}
                </span>
              )}
              {(cur.parseStatus === "failed" || cur.parseStatus === "skipped") && (
                <span className="flex items-center gap-2 text-danger">
                  {cur.parseError}
                  {data.hasApiKey && (
                    <button className="btn" onClick={() => reparse(cur.id)}>
                      Parse again
                    </button>
                  )}
                </span>
              )}
            </span>
          </div>
          {compact ? (
            cur.source && <ResumeSummary source={cur.source} />
          ) : cur.source ? (
            <ResumeEditor key={`${cur.id}-${cur.updatedAt}`} resume={cur} onSaved={load} onReparse={() => reparse(cur.id)} canReparse={data.hasApiKey} />
          ) : (
            <details className="card p-4 text-sm" open={cur.parseStatus !== "pending"}>
              <summary className="cursor-pointer font-medium">Extracted text</summary>
              <pre className="mt-3 whitespace-pre-wrap font-sans text-muted">{cur.parsedText}</pre>
            </details>
          )}
        </>
      )}

      {!compact && data.history.length > 1 && (
        <details className="text-sm text-muted">
          <summary className="cursor-pointer">Previous uploads ({data.history.length - 1})</summary>
          <ul className="mt-2 space-y-1">
            {data.history.slice(1).map((h) => (
              <li key={h.id}>
                {h.fileName} · {timeAgo(h.createdAt)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ResumeEditor({ resume, onSaved, onReparse, canReparse }: { resume: ResumeRow; onSaved: () => void; onReparse: () => void; canReparse: boolean }) {
  // Resumes parsed before these fields existed lack them.
  const [s, setS] = useState<ResumeSource>({
    ...resume.source!,
    education: resume.source!.education.map((e) => ({ ...e, details: e.details ?? [] })),
    additional: resume.source!.additional ?? [],
  });
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [confirmReread, setConfirmReread] = useState(false);
  const edit = (next: ResumeSource) => {
    setS(next);
    setDirty(true);
    setStatus(null);
  };

  async function save() {
    const res = await fetch(`/api/resume/${resume.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(renumber(s)),
    });
    if (!res.ok) {
      setStatus({ kind: "err", text: (await res.json()).error ?? "Save failed" });
      return;
    }
    setDirty(false);
    setStatus({ kind: "ok", text: "Saved. Fit scores will refresh against the updated resume." });
    onSaved();
  }

  const setExp = (i: number, patch: Partial<ResumeSource["experience"][number]>) =>
    edit({ ...s, experience: s.experience.map((e, j) => (j === i ? { ...e, ...patch } : e)) });

  return (
    <div className="space-y-4">
      <section className="card grid gap-3 p-5 md:grid-cols-2">
        <h2 className="section-title md:col-span-2">Contact</h2>
        {(["name", "email", "phone", "location"] as const).map((k) => (
          <label key={k} className="block">
            <span className="label capitalize">{k}</span>
            <input className="input" value={s.contact[k] ?? ""} onChange={(e) => edit({ ...s, contact: { ...s.contact, [k]: e.target.value || null } })} />
          </label>
        ))}
        <label className="block md:col-span-2">
          <span className="label">Links (one per line)</span>
          <textarea
            className="input"
            rows={2}
            value={s.contact.links.join("\n")}
            onChange={(e) => edit({ ...s, contact: { ...s.contact, links: lines(e.target.value) } })}
          />
        </label>
      </section>

      <section className="card space-y-2 p-5">
        <h2 className="section-title">Summary</h2>
        <textarea className="input" rows={3} value={s.summary ?? ""} onChange={(e) => edit({ ...s, summary: e.target.value || null })} />
      </section>

      <section className="card space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="section-title">Experience</h2>
          <button
            className="btn"
            onClick={() => edit({ ...s, experience: [...s.experience, { id: "", company: "", title: "", location: null, start: null, end: null, bullets: [] }] })}
          >
            <Plus aria-hidden className="size-4" /> Add role
          </button>
        </div>
        {s.experience.map((e, i) => (
          <div key={i} className="space-y-2 border-t border-border pt-4 first:border-0 first:pt-0">
            <div className="grid gap-2 md:grid-cols-[2fr_2fr_1.5fr_1fr_1fr_auto]">
              <input className="input" placeholder="Title" aria-label="Title" value={e.title} onChange={(ev) => setExp(i, { title: ev.target.value })} />
              <input className="input" placeholder="Company" aria-label="Company" value={e.company} onChange={(ev) => setExp(i, { company: ev.target.value })} />
              <input className="input" placeholder="Location" aria-label="Location" value={e.location ?? ""} onChange={(ev) => setExp(i, { location: ev.target.value || null })} />
              <input className="input" placeholder="Start" aria-label="Start" value={e.start ?? ""} onChange={(ev) => setExp(i, { start: ev.target.value || null })} />
              <input className="input" placeholder="End" aria-label="End" value={e.end ?? ""} onChange={(ev) => setExp(i, { end: ev.target.value || null })} />
              <button className="btn-ghost" aria-label={`Remove ${e.title || "role"}`} onClick={() => edit({ ...s, experience: s.experience.filter((_, j) => j !== i) })}>
                <X aria-hidden className="size-4" />
              </button>
            </div>
            <textarea
              className="input font-mono text-[13px]"
              rows={Math.max(3, e.bullets.length + 1)}
              placeholder="One bullet per line"
              aria-label={`Bullets for ${e.title || "role"} at ${e.company || "company"}`}
              value={e.bullets.map((b) => b.text).join("\n")}
              onChange={(ev) => setExp(i, { bullets: ev.target.value.split("\n").map((text, j) => ({ id: `e${i + 1}b${j + 1}`, text })) })}
              onBlur={(ev) => setExp(i, { bullets: lines(ev.target.value).map((text, j) => ({ id: `e${i + 1}b${j + 1}`, text })) })}
            />
          </div>
        ))}
      </section>

      <section className="card space-y-2 p-5">
        <h2 className="section-title">Skills</h2>
        {s.skills.map((k, i) => (
          <div key={i} className="flex gap-2">
            <input
              className="input w-44 shrink-0"
              placeholder="Category" aria-label="Skill category"
              value={k.category ?? ""}
              onChange={(e) => edit({ ...s, skills: s.skills.map((x, j) => (j === i ? { ...x, category: e.target.value || null } : x)) })}
            />
            <input
              className="input"
              placeholder="Comma-separated" aria-label="Skills"
              defaultValue={k.items.join(", ")}
              onBlur={(e) =>
                edit({ ...s, skills: s.skills.map((x, j) => (j === i ? { ...x, items: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) } : x)) })
              }
            />
            <button className="btn" aria-label="Remove skill group" onClick={() => edit({ ...s, skills: s.skills.filter((_, j) => j !== i) })}>
              <X aria-hidden className="size-4" />
            </button>
          </div>
        ))}
        <button className="btn" onClick={() => edit({ ...s, skills: [...s.skills, { category: null, items: [] }] })}>
          <Plus aria-hidden className="size-4" /> Add skill group
        </button>
      </section>

      <section className="card space-y-2 p-5">
        <h2 className="section-title">Education</h2>
        {s.education.map((ed, i) => (
          <div key={i} className="grid gap-2 md:grid-cols-[2fr_1.5fr_1.5fr_1fr_auto]">
            {(["school", "degree", "field", "end"] as const).map((k) => (
              <input
                key={k}
                className="input"
                placeholder={k === "end" ? "Year" : k[0]!.toUpperCase() + k.slice(1)}
                aria-label={k === "end" ? "Year" : k[0]!.toUpperCase() + k.slice(1)}
                value={ed[k] ?? ""}
                onChange={(e) =>
                  edit({ ...s, education: s.education.map((x, j) => (j === i ? { ...x, [k]: k === "school" ? e.target.value : e.target.value || null } : x)) })
                }
              />
            ))}
            <button className="btn" aria-label="Remove education" onClick={() => edit({ ...s, education: s.education.filter((_, j) => j !== i) })}>
              <X aria-hidden className="size-4" />
            </button>
            <textarea
              className="input md:col-span-5"
              rows={Math.max(1, ed.details.length)}
              placeholder="Details: GPA, honors, activities (one per line)"
              defaultValue={ed.details.join("\n")}
              onBlur={(e) => edit({ ...s, education: s.education.map((x, j) => (j === i ? { ...x, details: lines(e.target.value) } : x)) })}
            />
          </div>
        ))}
        <button className="btn" onClick={() => edit({ ...s, education: [...s.education, { school: "", degree: null, field: null, start: null, end: null, details: [] }] })}>
          <Plus aria-hidden className="size-4" /> Add education
        </button>
      </section>

      {s.projects.length > 0 && (
        <section className="card space-y-3 p-5">
          <h2 className="section-title">Projects</h2>
          {s.projects.map((p, i) => (
            <div key={i} className="space-y-2">
              <input
                className="input"
                value={p.name}
                onChange={(e) => edit({ ...s, projects: s.projects.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
              />
              <textarea
                className="input font-mono text-[13px]"
                rows={Math.max(2, p.bullets.length)}
                defaultValue={[p.description, ...p.bullets.map((b) => b.text)].filter(Boolean).join("\n")}
                onBlur={(e) => {
                  const [description = null, ...rest] = lines(e.target.value);
                  edit({ ...s, projects: s.projects.map((x, j) => (j === i ? { ...x, description, bullets: rest.map((text, k) => ({ id: `p${i + 1}b${k + 1}`, text })) } : x)) });
                }}
              />
            </div>
          ))}
        </section>
      )}

      <section className="card space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h2 className="section-title">Other sections</h2>
          <button className="btn" onClick={() => edit({ ...s, additional: [...s.additional, { heading: "", items: [] }] })}>
            <Plus aria-hidden className="size-4" /> Add section
          </button>
        </div>
        {s.additional.length === 0 && <p className="text-sm text-muted">Entrepreneurial experience, awards, publications, volunteering…</p>}
        {s.additional.map((a, i) => (
          <div key={i} className="space-y-2">
            <div className="flex gap-2">
              <input
                className="input"
                placeholder="Heading" aria-label="Section heading"
                value={a.heading}
                onChange={(e) => edit({ ...s, additional: s.additional.map((x, j) => (j === i ? { ...x, heading: e.target.value } : x)) })}
              />
              <button className="btn" aria-label="Remove section" onClick={() => edit({ ...s, additional: s.additional.filter((_, j) => j !== i) })}>
                <X aria-hidden className="size-4" />
              </button>
            </div>
            <textarea
              className="input"
              rows={Math.max(2, a.items.length + 1)}
              placeholder="One item per line"
              defaultValue={a.items.join("\n")}
              onBlur={(e) => edit({ ...s, additional: s.additional.map((x, j) => (j === i ? { ...x, items: lines(e.target.value) } : x)) })}
            />
          </div>
        ))}
      </section>

      <section className="card space-y-2 p-5">
        <h2 className="section-title">Certifications</h2>
        <textarea
          className="input"
          rows={2}
          placeholder="One per line"
          defaultValue={s.certifications.join("\n")}
          onBlur={(e) => edit({ ...s, certifications: lines(e.target.value) })}
        />
      </section>

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-border bg-surface/95 p-3 backdrop-blur">
        <span role="status" className={`mr-auto text-sm ${status?.kind === "ok" ? "text-good" : "text-danger"}`}>
          {status?.text ?? (dirty ? "Unsaved changes" : "")}
        </span>
        {canReparse && (
          <button className="btn" onClick={() => setConfirmReread(true)}>
            <RotateCcw aria-hidden className="size-4" /> Re-read PDF
          </button>
        )}
        <button className="btn-primary" disabled={!dirty} onClick={save}>
          <Save aria-hidden className="size-4" /> Save changes
        </button>
        <ConfirmDialog
          open={confirmReread}
          title="Re-read the PDF?"
          body="Claude reads your PDF again (about $0.03) and replaces the sections below. Any edits you've saved here will be lost."
          confirmLabel="Re-read and replace"
          danger
          onCancel={() => setConfirmReread(false)}
          onConfirm={() => {
            setConfirmReread(false);
            onReparse();
          }}
        />
      </div>
    </div>
  );
}

/** What was read, in one glance: enough to trust it without opening the editor. */
function ResumeSummary({ source }: { source: ResumeSource }) {
  const current = source.experience[0];
  const skills = source.skills.flatMap((s) => s.items);
  return (
    <div className="card grid gap-3 p-4 text-sm sm:grid-cols-3">
      <div>
        <p className="label">Name</p>
        <p className="font-medium">{source.contact.name ?? "Not found"}</p>
      </div>
      <div>
        <p className="label">Most recent role</p>
        <p className="font-medium">{current ? `${current.title}, ${current.company}` : "Not found"}</p>
      </div>
      <div>
        <p className="label">Experience and skills</p>
        <p className="font-medium tabular-nums">
          {source.experience.length} roles · {skills.length} skills
        </p>
      </div>
    </div>
  );
}
