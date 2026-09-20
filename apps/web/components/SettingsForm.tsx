"use client";

import { CheckCircle2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Skeleton } from "@/components/ui";

export type FieldType = "boolean" | "number" | "nullableNumber" | "text" | "list" | "select" | "multiselect" | "time";
export interface Field {
  path: string;
  label: string;
  type: FieldType;
  hint?: string;
  options?: { value: string; label: string }[];
}
export interface Section {
  key: string;
  endpoint: string;
  title: string;
  description: string;
  fields: Field[];
  note?: string;
}

/**
 * A settings card driven by a field list: loads from `endpoint`, saves with PUT, and shows
 * validation errors next to the field that caused them.
 */
function getPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}
function setPath(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const [head, ...rest] = path.split(".") as [string, ...string[]];
  if (rest.length === 0) return { ...obj, [head]: value };
  return { ...obj, [head]: setPath((obj[head] as Record<string, unknown>) ?? {}, rest.join("."), value) };
}

export function SectionForm({ section, children }: { section: Section; children?: React.ReactNode }) {
  const [value, setValue] = useState<Record<string, unknown> | null>(null);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(section.endpoint).then((r) => r.json()).then(setValue);
  }, [section.endpoint]);

  const update = (path: string, v: unknown) => {
    setValue((cur) => setPath(cur ?? {}, path, v));
    setDirty(true);
    setStatus(null);
    setFieldErrors(({ [path]: _, ...rest }) => rest);
  };

  async function save() {
    setSaving(true);
    const res = await fetch(section.endpoint, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
    });
    const body = await res.json();
    setSaving(false);
    if (!res.ok) {
      const issues = (body.issues ?? []) as { path: (string | number)[]; message: string }[];
      const byField = Object.fromEntries(issues.map((i) => [i.path.join("."), friendlyError(i.message)]));
      setFieldErrors(byField);
      const n = issues.length;
      setStatus({ kind: "err", text: n ? `Fix ${n === 1 ? "the highlighted field" : `${n} highlighted fields`} and save again.` : body.error ?? "Couldn't save." });
      return;
    }
    setValue(body);
    setDirty(false);
    setFieldErrors({});
    setStatus({ kind: "ok", text: "Saved" });
  }

  return (
    <section id={section.key} aria-labelledby={`${section.key}-title`} className="card scroll-mt-20 p-5 sm:p-6">
      <div className="mb-5">
        <h2 id={`${section.key}-title`} className="section-title">
          {section.title}
        </h2>
        <p className="text-sm text-muted">{section.description}</p>
        {section.note && <p className="mt-1 text-xs text-warn">{section.note}</p>}
      </div>
      {!value ? (
        <div className="grid gap-4 md:grid-cols-2" aria-hidden>
          {section.fields.slice(0, 4).map((f) => (
            <Skeleton key={f.path} className="h-14" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {section.fields.map((f) => (
            <FieldInput key={f.path} field={f} value={getPath(value, f.path)} error={fieldErrors[f.path]} onChange={(v) => update(f.path, v)} />
          ))}
        </div>
      )}
      {value && children}
      <div className="mt-5 flex items-center justify-end gap-3 border-t border-border pt-4">
        <span role="status" className={`inline-flex items-center gap-1 text-sm ${status?.kind === "ok" ? "text-good" : "text-danger"}`}>
          {status?.kind === "ok" && <CheckCircle2 aria-hidden className="size-4" />}
          {status?.text ?? (dirty ? <span className="text-muted">Unsaved changes</span> : "")}
        </span>
        <button className="btn-primary" onClick={save} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );
}

function friendlyError(message: string): string {
  if (/regex|pattern/i.test(message)) return "Use the format HH:MM, e.g. 08:00.";
  if (/email/i.test(message)) return "Enter a valid email address.";
  if (/too_small|>=|at least/i.test(message)) return "Value is too small.";
  if (/too_big|<=|at most/i.test(message)) return "Value is too large.";
  return message;
}

function FieldInput({ field, value, error, onChange }: { field: Field; value: unknown; error?: string; onChange: (v: unknown) => void }) {
  const id = useId();
  const describedBy = error ? `${id}-err` : field.hint ? `${id}-hint` : undefined;
  const common = { id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy } as const;
  const wrap = (control: React.ReactNode, span2 = false) => (
    <div className={span2 ? "md:col-span-2" : ""}>
      {field.type !== "boolean" && (
        <label htmlFor={id} className="label">
          {field.label}
        </label>
      )}
      {control}
      {error ? (
        <p id={`${id}-err`} className="field-error">
          {error}
        </p>
      ) : (
        field.hint &&
        field.type !== "text" && (
          <p id={`${id}-hint`} className="helper">
            {field.hint}
          </p>
        )
      )}
    </div>
  );

  switch (field.type) {
    case "boolean":
      return wrap(
        <label htmlFor={id} className="flex min-h-9 items-center gap-2 text-sm">
          <input {...common} type="checkbox" className="size-4 accent-[var(--accent)]" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          {field.label}
        </label>,
        true,
      );
    case "select":
      return wrap(
        <select {...common} className="input" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {field.options!.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>,
      );
    case "multiselect": {
      const selected = (value as string[]) ?? [];
      return (
        <fieldset>
          <legend className="label">{field.label}</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            {field.options!.map((o) => (
              <label key={o.value} className="flex min-h-9 items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--accent)]"
                  checked={selected.includes(o.value)}
                  onChange={(e) => onChange(e.target.checked ? [...selected, o.value] : selected.filter((s) => s !== o.value))}
                />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>
      );
    }
    case "list":
      return wrap(
        <input
          {...common}
          className="input"
          defaultValue={((value as string[]) ?? []).join(", ")}
          onChange={(e) =>
            onChange(
              e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
        />,
      );
    case "number":
    case "nullableNumber":
      return wrap(
        <input
          {...common}
          className="input tabular-nums"
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          value={value === null || value === undefined ? "" : String(value)}
          placeholder={field.type === "nullableNumber" ? "No limit" : undefined}
          onChange={(e) => onChange(e.target.value === "" ? (field.type === "nullableNumber" ? null : 0) : Number(e.target.value))}
        />,
      );
    case "time":
    case "text":
      return wrap(
        <input
          {...common}
          className="input"
          type={field.type === "time" ? "time" : /email/i.test(field.path) ? "email" : /phone/i.test(field.path) ? "tel" : /links\./.test(field.path) ? "url" : "text"}
          autoComplete={field.path === "name" ? "name" : field.path === "email" ? "email" : field.path === "phone" ? "tel" : undefined}
          value={String(value ?? "")}
          placeholder={field.hint}
          onChange={(e) => onChange(e.target.value)}
        />,
      );
  }
}

