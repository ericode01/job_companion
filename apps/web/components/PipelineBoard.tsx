"use client";

import type { ApplicationStatus } from "@jd/core/shared";
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, GripVertical, KanbanSquare, Mail, MailCheck, Search, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionStrip } from "@/components/ActionStrip";
import { ApplicationPanel } from "@/components/ApplicationPanel";
import { ReviewList } from "@/components/ReviewList";
import { RoundChips } from "@/components/RoundTracker";
import { FitBadge } from "@/components/Status";
import { ConfirmDialog, EmptyState, type Feedback, FeedbackBar, Skeleton } from "@/components/ui";
import { formatComp, timeAgo } from "@/lib/format";
import { shortDate } from "@/lib/mail-labels";
import { groupColumn } from "@/lib/pipeline-groups";
import { emailAction, type ChangeJson, type PipelineCard, type PipelineData, type SearchTag } from "@/lib/pipeline-types";
import { STATUS_LABELS } from "@/lib/types";

const COLUMNS: { key: string; title: string; statuses: ApplicationStatus[] }[] = [
  { key: "saved", title: "Saved", statuses: ["saved"] },
  { key: "applying", title: "Applying", statuses: ["applying"] },
  { key: "applied", title: "Applied", statuses: ["applied"] },
  { key: "interview", title: "Interview", statuses: ["interview"] },
  { key: "offer", title: "Offer", statuses: ["offer"] },
  { key: "rejected", title: "Rejected", statuses: ["rejected", "withdrawn"] },
];

/** Per-browser conveniences: they may be blocked, and the page must work without them. */
const REJECTED_KEY = "jc:rejected-open";
const SCOPE_KEY = "jc:pipeline-search";
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/** The board's state lives in the URL too, so a filtered view and an open card can be linked. */
function syncUrl(params: { scope: number | null; q: string; app: number | null }) {
  const url = new URL(window.location.href);
  const set = (key: string, value: string | null) => (value === null || value === "" ? url.searchParams.delete(key) : url.searchParams.set(key, value));
  set("search", params.scope === null ? null : String(params.scope));
  set("q", params.q.trim());
  set("app", params.app === null ? null : String(params.app));
  window.history.replaceState(window.history.state, "", url);
}

const hay = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" ").toLowerCase();

export function PipelineBoard() {
  const [data, setData] = useState<PipelineData | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<PipelineCard | null>(null);
  const [announce, setAnnounce] = useState("");
  const [panel, setPanel] = useState<number | null>(null);
  const [rejectedOpen, setRejectedOpen] = useState(false);
  const [scope, setScope] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const router = useRouter();
  const load = useCallback(async () => {
    const res = await fetch("/api/pipeline");
    if (res.ok) setData(await res.json());
  }, []);
  /** After a change: reload the board, and the header's counts (switcher, nav) with it. */
  const changed = useCallback(() => {
    void load();
    router.refresh();
  }, [load, router]);

  useEffect(() => {
    void load();
    setRejectedOpen(read(REJECTED_KEY) === "1");
    const url = new URL(window.location.href);
    const fromUrl = Number(url.searchParams.get("app"));
    if (fromUrl) setPanel(fromUrl);
    // A link's filter wins over the one you last used here; a link to one card shows them all.
    const searchParam = url.searchParams.get("search");
    const chosen = Number(searchParam || (fromUrl ? "" : read(SCOPE_KEY)) || Number.NaN);
    if (Number.isInteger(chosen) && chosen > 0) setScope(chosen);
    setQ(url.searchParams.get("q") ?? "");
  }, [load]);

  const openPanel = (id: number | null) => {
    setPanel(id);
    syncUrl({ scope, q, app: id });
  };

  const chooseScope = (next: number | null) => {
    setScope(next);
    write(SCOPE_KEY, next === null ? "all" : String(next));
    syncUrl({ scope: next, q, app: panel });
  };

  const changeQuery = (next: string) => {
    setQ(next);
    syncUrl({ scope, q: next, app: panel });
  };

  const all = useMemo(() => data?.cards ?? [], [data]);
  const searches: SearchTag[] = data?.searches ?? [];
  const text = q.trim().toLowerCase();
  const inScope = useCallback(
    <T extends { searchId: number | null }>(rows: T[], textOf: (row: T) => string) =>
      rows.filter((r) => (scope === null || r.searchId === scope) && (!text || textOf(r).includes(text))),
    [scope, text],
  );

  const cards = useMemo(() => inScope(all, (c) => hay(c.companyName, c.title)), [all, inScope]);
  const actions = useMemo(() => inScope(data?.actions ?? [], (a) => hay(a.company, a.title)), [data, inScope]);
  const review = useMemo(() => inScope(data?.review ?? [], (r) => hay(r.companyName, r.jobTitle, r.subject)), [data, inScope]);
  const changes = useMemo(() => inScope(data?.changes ?? [], (c) => hay(c.company, c.title)), [data, inScope]);
  // Every card, so the panel can move an application to any of them.
  const appOptions = useMemo(() => all.map((c) => ({ id: c.id, label: `${c.companyName} · ${c.title}` })), [all]);
  const countFor = (id: number | null) => (id === null ? all.length : all.filter((c) => c.searchId === id).length);

  /** Filter changes are announced in words, not as a bare number, and only when they change. */
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (!data) return;
    const key = `${scope}|${text}`;
    if (announced.current === null || announced.current === key) {
      announced.current = key;
      return;
    }
    announced.current = key;
    const where = scope === null ? "all your searches" : (searches.find((s) => s.id === scope)?.name ?? "that search");
    setAnnounce(`Showing ${cards.length} ${cards.length === 1 ? "application" : "applications"} in ${where}${text ? ` matching “${q.trim()}”` : ""}`);
    // Only a filter change should speak; a reload after an edit shouldn't.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, text, data]);

  /** Moves the card at once, then tells you if the server disagreed — never a silent revert. */
  async function move(card: PipelineCard, status: ApplicationStatus | null) {
    setData((d) =>
      d && {
        ...d,
        cards: d.cards.flatMap((c) => (c.id !== card.id ? [c] : status ? [{ ...c, status, updatedAt: new Date().toISOString() }] : [])),
      },
    );
    setAnnounce(status ? `${card.title} moved to ${STATUS_LABELS[status]}` : `${card.title} removed from pipeline`);
    const res = await fetch(
      `/api/pipeline/${card.id}`,
      status ? { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) } : { method: "DELETE" },
    ).catch(() => null);
    if (!res?.ok) {
      const said = res ? ((await res.json().catch(() => ({}))) as { error?: string }).error : "You may be offline.";
      setFeedback({
        tone: "error",
        text: `Couldn't ${status ? `move “${card.title}” to ${STATUS_LABELS[status]}` : `remove “${card.title}”`}. ${said ?? ""}`.trim(),
        action: { label: "Retry", run: () => move(card, status) },
      });
    }
    changed();
  }

  /** Clearing an action is reversible: the same email can be reopened. */
  async function markDone(emailId: number) {
    const row = data?.actions.find((a) => a.emailId === emailId);
    setData((d) => d && { ...d, actions: d.actions.filter((a) => a.emailId !== emailId) });
    try {
      await emailAction(emailId, { type: "done", done: true });
      changed();
      setFeedback({
        text: row ? `Marked done: ${row.company}.` : "Marked done.",
        action: {
          label: "Undo",
          run: async () => {
            try {
              await emailAction(emailId, { type: "done", done: false });
              changed();
            } catch (e) {
              setFeedback({ tone: "error", text: e instanceof Error ? e.message : "Couldn't undo that." });
            }
          },
        },
      });
    } catch (e) {
      void load();
      setFeedback({
        tone: "error",
        text: e instanceof Error ? e.message : "Couldn't mark that done.",
        action: { label: "Retry", run: () => markDone(emailId) },
      });
    }
  }

  const toggleRejected = () => {
    setRejectedOpen((o) => {
      write(REJECTED_KEY, !o ? "1" : "0");
      return !o;
    });
  };

  const drop = (col: (typeof COLUMNS)[number]) => (e: React.DragEvent) => {
    e.preventDefault();
    setOver(null);
    const card = all.find((c) => c.id === dragging);
    if (card && !col.statuses.includes(card.status)) void move(card, col.statuses[0]!);
  };
  const dragOver = (key: string) => (e: React.DragEvent) => {
    e.preventDefault();
    setOver(key);
  };

  if (!data) {
    return (
      <div role="status" aria-label="Loading pipeline" className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {COLUMNS.map((c) => (
          <Skeleton key={c.key} className="h-40 rounded-xl" />
        ))}
      </div>
    );
  }

  const rejectedCount = cards.filter((c) => c.status === "rejected" || c.status === "withdrawn").length;
  const collapsed = !rejectedOpen && rejectedCount > 0;
  const filtered = scope !== null || text.length > 0;

  return (
    <div className="space-y-4">
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      {(searches.length > 1 || all.length > 0) && (
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div role="group" aria-label="Filter by job search" className="flex flex-wrap items-center gap-1.5">
            <ScopeChip label="All" count={countFor(null)} active={scope === null} onClick={() => chooseScope(null)} />
            {searches.map((s) => (
              <ScopeChip key={s.id} label={s.name} note={s.archived ? "Archived" : undefined} count={countFor(s.id)} active={scope === s.id} onClick={() => chooseScope(s.id)} />
            ))}
          </div>
          <div className="relative lg:w-64">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={q}
              onChange={(e) => changeQuery(e.target.value)}
              placeholder="Find a company or role"
              aria-label="Find a company or role"
              className="input min-h-11 w-full pl-8"
            />
            {q && (
              <button type="button" onClick={() => changeQuery("")} aria-label="Clear search" className="btn-ghost absolute top-1/2 right-1 size-9 -translate-y-1/2 px-0">
                <X aria-hidden className="size-4" />
              </button>
            )}
          </div>
        </div>
      )}

      <ActionStrip actions={actions} onOpen={openPanel} onDone={(emailId) => void markDone(emailId)} />
      <ReviewList items={review} applications={appOptions} onChanged={changed} />
      <EmailChanges changes={changes} onOpen={openPanel} onUndone={changed} onFeedback={setFeedback} />

      <ConfirmDialog
        open={confirmRemove !== null}
        title="Remove from pipeline?"
        body={confirmRemove ? `“${confirmRemove.title}” at ${confirmRemove.companyName} will no longer be tracked.` : ""}
        confirmLabel="Remove"
        danger
        onCancel={() => setConfirmRemove(null)}
        onConfirm={() => {
          if (confirmRemove) void move(confirmRemove, null);
          setConfirmRemove(null);
        }}
      />

      {cards.length === 0 ? (
        filtered ? (
          <EmptyState title="Nothing here with those filters" icon={<KanbanSquare className="size-5" />}>
            <button type="button" onClick={() => { chooseScope(null); changeQuery(""); }} className="font-medium text-accent hover:underline">
              Show all {all.length} applications
            </button>
          </EmptyState>
        ) : (
          <EmptyState title="Nothing tracked yet" icon={<KanbanSquare className="size-5" />}>
            Open a job from{" "}
            <Link href={searches[0] ? `/d/${searches[0].id}` : "/searches/new"} className="font-medium text-accent hover:underline">
              {searches[0] ? "your search" : "a new search"}
            </Link>{" "}
            and save it, or click Apply.{" "}
            {data.mailbox.connected ? (
              "Applications you make elsewhere show up here too, once their confirmation email arrives."
            ) : (
              <>
                Or{" "}
                <Link href="/mailbox" className="font-medium text-accent hover:underline">
                  connect your inbox
                </Link>{" "}
                to bring in applications you&apos;ve made elsewhere.
              </>
            )}
          </EmptyState>
        )
      ) : (
        <>
          <PipelineSummary cards={cards} />
          <div
            className={`grid gap-3 pb-2 md:grid-cols-3 ${collapsed ? "xl:grid-cols-[repeat(5,minmax(0,1fr))_3.25rem]" : "xl:grid-cols-6"}`}
          >
            {COLUMNS.map((col) => {
              const colCards = cards.filter((c) => col.statuses.includes(c.status));
              const isRejected = col.key === "rejected";
              const dropProps = { onDragOver: dragOver(col.key), onDragLeave: () => setOver(null), onDrop: drop(col) };
              if (isRejected && collapsed) {
                return (
                  <button
                    key={col.key}
                    type="button"
                    {...dropProps}
                    onClick={toggleRejected}
                    aria-expanded={false}
                    aria-label={`Rejected: ${colCards.length}. Show them`}
                    className={`flex min-h-11 items-center justify-between gap-2 rounded-xl border px-3 text-xs font-semibold tracking-wide text-muted uppercase transition-colors duration-150 hover:border-border-strong hover:text-text md:col-span-3 xl:col-span-1 xl:min-h-40 xl:flex-col xl:justify-start xl:px-0 xl:py-3 ${
                      over === col.key ? "border-accent bg-accent-soft" : "border-border bg-surface-2/60"
                    }`}
                  >
                    <span className="xl:[writing-mode:vertical-rl]">Rejected</span>
                    <span className="flex items-center gap-1 tabular-nums">
                      {colCards.length}
                      <ChevronRight aria-hidden className="size-4 max-xl:rotate-90" />
                    </span>
                  </button>
                );
              }
              const groups = groupColumn(col.key, colCards, { grouped: !isRejected });
              return (
                <div
                  key={col.key}
                  {...dropProps}
                  // min-w-0: a truncated line in a compact card must not stretch the column.
                  className={`min-h-40 min-w-0 rounded-xl border p-2 transition-colors duration-150 ${over === col.key ? "border-accent bg-accent-soft" : "border-border bg-surface-2/60"}`}
                >
                  <h2 className="mb-2 flex items-center justify-between px-1 text-xs font-semibold tracking-wide text-muted uppercase">
                    {col.title}
                    <span className="flex items-center gap-1">
                      <span className="tabular-nums">{colCards.length}</span>
                      {isRejected && colCards.length > 0 && (
                        <button type="button" className="btn-ghost -mr-1 size-8 px-0" onClick={toggleRejected} aria-expanded aria-label="Collapse rejected">
                          <ChevronLeft aria-hidden className="size-4 max-xl:rotate-90" />
                        </button>
                      )}
                    </span>
                  </h2>
                  {groups.map((g) => (
                    <div key={g.bucket} className="space-y-2">
                      {g.label && (
                        <h3 className="sticky top-16 z-10 -mx-1 rounded-md bg-surface-2/95 px-1.5 py-1 text-[11px] font-medium text-muted backdrop-blur">
                          {g.label} <span className="tabular-nums">({g.cards.length})</span>
                        </h3>
                      )}
                      <ul className="space-y-2 pb-2">
                        {g.cards.map((c) =>
                          isRejected ? (
                            <CompactCard key={c.id} card={c} onOpen={() => openPanel(c.id)} onDragStart={() => setDragging(c.id)} onDragEnd={() => setDragging(null)} />
                          ) : (
                            <Card
                              key={c.id}
                              card={c}
                              dragging={dragging === c.id}
                              onOpen={() => openPanel(c.id)}
                              onDragStart={() => setDragging(c.id)}
                              onDragEnd={() => setDragging(null)}
                              onStatus={(s) => (s === null ? setConfirmRemove(c) : void move(c, s))}
                            />
                          ),
                        )}
                      </ul>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}

      <ApplicationPanel appId={panel} applications={appOptions} onClose={() => openPanel(null)} onChanged={changed} />
      <FeedbackBar feedback={feedback} onDismiss={() => setFeedback(null)} />
    </div>
  );
}

/** One job search as a filter. The count is part of the label, never colour alone. */
function ScopeChip({ label, note, count, active, onClick }: { label: string; note?: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-h-11 max-w-full items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors ${
        active ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border bg-surface text-muted hover:border-border-strong hover:text-text"
      }`}
    >
      <span className="truncate">{label}</span>
      {note && <span className="chip bg-surface-2 text-xs text-muted">{note}</span>}
      <span className="tabular-nums">{count}</span>
    </button>
  );
}

function Card({
  card: c,
  dragging,
  onOpen,
  onDragStart,
  onDragEnd,
  onStatus,
}: {
  card: PipelineCard;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onStatus: (s: ApplicationStatus | null) => void;
}) {
  return (
    <li
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`card cursor-grab space-y-1.5 p-3 text-sm transition-colors duration-150 hover:border-border-strong active:cursor-grabbing ${dragging ? "opacity-60" : ""}`}
    >
      {c.openActions > 0 && (
        <span className="chip bg-warn-soft text-warn">
          <AlertTriangle aria-hidden className="size-3" /> Action needed
        </span>
      )}
      <div className="flex gap-1">
        <button type="button" onClick={onOpen} className="flex-1 text-left leading-snug font-semibold hover:text-accent">
          {c.title}
        </button>
        <GripVertical aria-hidden className="size-4 shrink-0 text-muted" />
      </div>
      <p className="text-muted">{c.companyName}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {c.confirmedAt && (
          <span className="chip bg-good-soft text-good" title={`Confirmation email ${shortDate(c.confirmedAt)}`}>
            <MailCheck aria-hidden className="size-3" /> Confirmed
          </span>
        )}
        <FitBadge score={c.fitScore} />
        {formatComp(c.comp) && <span className="chip bg-good-soft text-good">{formatComp(c.comp)}</span>}
        {c.source === "email" && <span className="chip bg-surface-2 text-muted">Applied elsewhere</span>}
        {c.closedAt && <span className="chip bg-warn-soft text-warn">Posting closed</span>}
      </div>
      {(c.status === "interview" || c.status === "offer") && <RoundChips rounds={c.rounds} />}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 pt-1 text-xs text-muted">
        <span className="flex items-center gap-2">
          {c.appliedAt ? `Applied ${timeAgo(c.appliedAt)}` : `Updated ${timeAgo(c.updatedAt)}`}
          {c.emailCount > 0 && (
            <button type="button" onClick={onOpen} className="inline-flex items-center gap-0.5 hover:text-accent" aria-label={`${c.emailCount} ${c.emailCount === 1 ? "email" : "emails"} about ${c.title}`}>
              <Mail aria-hidden className="size-3" /> {c.emailCount}
            </button>
          )}
        </span>
        <select
          className="min-h-8 max-w-full rounded-md border border-border bg-surface px-1.5 text-xs text-text"
          value={c.status}
          aria-label={`Status of ${c.title}`}
          onChange={(e) => onStatus(e.target.value === "" ? null : (e.target.value as ApplicationStatus))}
        >
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
          <option value="">Remove</option>
        </select>
      </div>
    </li>
  );
}

/** Rejections can pile up, so they're one line each. */
function CompactCard({ card: c, onOpen, onDragStart, onDragEnd }: { card: PipelineCard; onOpen: () => void; onDragStart: () => void; onDragEnd: () => void }) {
  return (
    <li draggable onDragStart={onDragStart} onDragEnd={onDragEnd} className="rounded-lg border border-border bg-surface px-2.5 py-2 text-xs">
      <button type="button" onClick={onOpen} className="block w-full text-left hover:text-accent">
        <span className="block truncate font-medium">{c.companyName}</span>
        <span className="block truncate text-muted">{c.title}</span>
      </button>
      <span className="mt-0.5 block text-muted">
        {c.status === "withdrawn" ? "Withdrawn · " : ""}
        {timeAgo(c.updatedAt)}
      </span>
    </li>
  );
}

/** What your email changed this week, each undoable. */
function EmailChanges({
  changes,
  onOpen,
  onUndone,
  onFeedback,
}: {
  changes: ChangeJson[];
  onOpen: (appId: number) => void;
  onUndone: () => void;
  onFeedback: (f: Feedback) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!changes.length) return null;
  const counts = new Map<string, number>();
  for (const c of changes) {
    const key = c.fromStatus === null ? "added" : c.toStatus;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const words: Record<string, string> = { added: "added", applied: "moved to Applied", interview: "moved to Interview", offer: "moved to Offer", rejected: "moved to Rejected" };
  const summary = [...counts].map(([k, n]) => `${n} ${words[k] ?? `moved to ${k}`}`).join(", ");
  return (
    <section aria-label="Changes from your email" className="rounded-xl border border-border bg-surface px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Mail aria-hidden className="size-4 text-accent" />
        <p className="flex-1">
          <span className="font-medium">From your email this week:</span> <span className="text-muted">{summary}.</span>
        </p>
        <button type="button" className="btn-ghost min-h-9 text-xs" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <ChevronDown aria-hidden className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
          {open ? "Hide" : "Review"}
        </button>
      </div>
      {open && (
        <ul className="mt-2 divide-y divide-border border-t border-border">
          {changes.map((c) => (
            <li key={c.eventId} className="flex flex-wrap items-center gap-2 py-2">
              <button type="button" className="min-w-0 flex-1 truncate text-left hover:text-accent" onClick={() => onOpen(c.applicationId)}>
                <span className="font-medium">{c.company}</span> <span className="text-muted">· {c.title}</span>
              </button>
              <span className="text-xs text-muted">
                {c.fromStatus === null ? `Added as ${STATUS_LABELS[c.toStatus]}` : `${STATUS_LABELS[c.fromStatus]} → ${STATUS_LABELS[c.toStatus]}`} · {shortDate(c.createdAt)}
              </span>
              <button
                type="button"
                className="btn-ghost min-h-8 text-xs"
                onClick={async () => {
                  const res = await fetch(`/api/pipeline/${c.applicationId}/undo`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ eventId: c.eventId }),
                  }).catch(() => null);
                  if (!res?.ok) {
                    const said = res ? ((await res.json().catch(() => ({}))) as { error?: string }).error : "You may be offline.";
                    onFeedback({ tone: "error", text: said ?? "Couldn't undo that." });
                  }
                  onUndone();
                }}
              >
                <Undo2 aria-hidden className="size-3.5" /> {c.fromStatus === null ? "Remove" : "Undo"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** From search to offer at a glance: how many made it to each stage. */
function PipelineSummary({ cards }: { cards: PipelineCard[] }) {
  const reached = (statuses: ApplicationStatus[]) => cards.filter((c) => statuses.includes(c.status)).length;
  const stages = [
    { label: "Saved", n: reached(["saved"]) },
    { label: "In progress", n: reached(["applying"]) },
    { label: "Applied", n: reached(["applied", "interview", "offer"]) },
    { label: "Interviewing", n: reached(["interview", "offer"]) },
    { label: "Offers", n: reached(["offer"]) },
  ];
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 text-sm" aria-label="Progress">
        {stages.map((s, i) => (
          <li key={s.label} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden className="px-1 text-muted">›</span>}
            <span className={`chip ${s.label === "Offers" && s.n > 0 ? "bg-good-soft text-good" : "bg-surface-2 text-text"}`}>
              <span className="font-semibold tabular-nums">{s.n}</span> {s.label}
            </span>
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted">Drag cards between columns, or use the menu on each card. Click a title for its emails.</p>
    </div>
  );
}
