"use client";

import type { LocationTarget, SearchFilter } from "@jd/core/shared";
import { MapPin, Plus, X } from "lucide-react";
import { useId } from "react";

const splitList = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

function ListField({ label, helper, value, onChange }: { label: string; helper: string; value: string[]; onChange: (v: string[]) => void }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input id={id} className="input" defaultValue={value.join(", ")} onBlur={(e) => onChange(splitList(e.target.value))} aria-describedby={`${id}-h`} />
      <p id={`${id}-h`} className="helper">
        {helper}
      </p>
    </div>
  );
}

export function FilterEditor({ filter, onChange }: { filter: SearchFilter; onChange: (f: SearchFilter) => void }) {
  const set = <K extends keyof SearchFilter>(k: K, v: SearchFilter[K]) => onChange({ ...filter, [k]: v });
  const setLocation = (i: number, loc: LocationTarget | null) => {
    const next = [...filter.locations];
    if (loc) next[i] = loc;
    else next.splice(i, 1);
    set("locations", next);
  };
  const ageId = useId();

  return (
    <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
      <fieldset className="space-y-4">
        <legend className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Title</legend>
        <ListField label="Must contain one of" helper="Comma-separated, e.g. software engineer, developer" value={filter.roleKeywords} onChange={(v) => set("roleKeywords", v)} />
        <ListField label="Level" helper="Leave empty for any level" value={filter.levelKeywords} onChange={(v) => set("levelKeywords", v)} />
        <ListField label="Exclude titles containing" helper="e.g. manager, sales engineer" value={filter.excludeKeywords} onChange={(v) => set("excludeKeywords", v)} />
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Where and when</legend>
        <div className="space-y-2">
          <span className="label">Locations</span>
          {filter.locations.map((loc, i) => (
            <div key={`${loc.label}-${i}`} className="rounded-lg border border-border p-2">
              <div className="flex items-center gap-2">
                <MapPin aria-hidden className="size-4 shrink-0 text-muted" />
                <input
                  className="input"
                  defaultValue={loc.label}
                  onBlur={(e) => setLocation(i, { ...loc, label: e.target.value })}
                  aria-label={`Location ${i + 1} name`}
                  disabled={filter.remoteOnly}
                />
                <button type="button" className="btn-ghost shrink-0" onClick={() => setLocation(i, null)} aria-label={`Remove ${loc.label || "location"}`}>
                  <X aria-hidden className="size-4" />
                </button>
              </div>
              <input
                className="input mt-2 text-xs"
                defaultValue={loc.aliases.join(", ")}
                onBlur={(e) => setLocation(i, { ...loc, aliases: splitList(e.target.value) })}
                aria-label={`Location ${i + 1}: match job locations containing`}
                title="Matches job locations containing any of these"
                disabled={filter.remoteOnly}
              />
            </div>
          ))}
          <button type="button" className="btn" disabled={filter.remoteOnly} onClick={() => set("locations", [...filter.locations, { label: "", aliases: [] }])}>
            <Plus aria-hidden className="size-4" /> Add location
          </button>
          <p className="helper">
            {filter.remoteOnly ? "Remote only: locations are ignored." : filter.locations.length === 0 ? "No location: matches anywhere." : "Second line: text that identifies the place in a posting."}
          </p>
        </div>
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={filter.remoteOnly ?? false} onChange={(e) => set("remoteOnly", e.target.checked)} />
            Remote roles only (US)
          </label>
          <label className={`flex items-center gap-2 ${filter.remoteOnly ? "opacity-50" : ""}`}>
            <input
              type="checkbox"
              className="size-4 accent-[var(--accent)]"
              checked={filter.includeRemoteUS}
              disabled={filter.remoteOnly}
              onChange={(e) => set("includeRemoteUS", e.target.checked)}
            />
            Also include remote roles open to the US
          </label>
        </div>
        <div>
          <label htmlFor={ageId} className="label">
            Posted within
          </label>
          <select id={ageId} className="input w-auto" value={filter.postedWithinDays ?? ""} onChange={(e) => set("postedWithinDays", e.target.value ? Number(e.target.value) : null)}>
            {[1, 3, 7, 14, 30, 60, 90].map((d) => (
              <option key={d} value={d}>
                {d} {d === 1 ? "day" : "days"}
              </option>
            ))}
            <option value="">Any time</option>
          </select>
        </div>
      </fieldset>
    </div>
  );
}
