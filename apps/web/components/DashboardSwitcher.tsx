"use client";

import { Check, ChevronsUpDown, LayoutDashboard, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

export interface SwitcherItem {
  id: number;
  name: string;
  newCount: number;
}

/**
 * One job search on screen at a time: the header shows the current dashboard, and this menu
 * lists the others (with how many jobs are new since you last looked) plus "New search".
 */
export function DashboardSwitcher({ dashboards, lastId }: { dashboards: SwitcherItem[]; lastId: number | null }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const fromPath = pathname.match(/^\/d\/(\d+)/)?.[1];
  const activeId = Number(fromPath ?? params.get("d") ?? lastId ?? dashboards[0]?.id ?? NaN);
  const active = dashboards.find((d) => d.id === activeId) ?? null;
  const inDashboard = Boolean(fromPath);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    list.current?.querySelector<HTMLElement>("a")?.focus();
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      root.current?.querySelector<HTMLElement>("button")?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(list.current?.querySelectorAll<HTMLElement>("a") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };

  const otherNew = dashboards.filter((d) => d.id !== active?.id).reduce((n, d) => n + d.newCount, 0);

  return (
    <div ref={root} className="relative min-w-0 flex-1 sm:flex-none" onKeyDown={onKeyDown}>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        className={`flex min-h-10 w-full max-w-[22rem] items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition-colors ${
          inDashboard ? "border-border bg-surface hover:border-border-strong" : "border-transparent text-muted hover:bg-surface-2 hover:text-text"
        }`}
      >
        <LayoutDashboard aria-hidden className="size-4 shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate text-left">{active?.name ?? "Your searches"}</span>
        {otherNew > 0 && (
          <span className="chip shrink-0 bg-accent-soft px-1.5 text-accent tabular-nums" title="New jobs in your other searches">
            {otherNew > 99 ? "99+" : otherNew}
            <span className="sr-only"> new in other searches</span>
          </span>
        )}
        <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-muted" />
      </button>

      {open && (
        <div id={menuId} className="absolute top-full left-0 z-50 mt-1.5 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-1.5 shadow-lg">
          <p className="px-2.5 pt-1.5 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">Job searches</p>
          <ul ref={list} className="max-h-[60vh] overflow-y-auto">
            {dashboards.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/d/${d.id}`}
                  aria-current={d.id === active?.id ? "page" : undefined}
                  className="flex min-h-10 items-center gap-2 rounded-lg px-2.5 text-sm transition-colors hover:bg-surface-2 focus:bg-surface-2 focus:outline-none aria-[current=page]:font-semibold"
                >
                  <Check aria-hidden className={`size-4 shrink-0 ${d.id === active?.id ? "text-accent" : "invisible"}`} />
                  <span className="min-w-0 flex-1 truncate">{d.name}</span>
                  {d.newCount > 0 && <span className="chip bg-accent-soft text-accent tabular-nums">{d.newCount} new</span>}
                </Link>
              </li>
            ))}
            <li className="mt-1 border-t border-border pt-1">
              <Link
                href="/searches/new"
                className="flex min-h-10 items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-accent transition-colors hover:bg-surface-2 focus:bg-surface-2 focus:outline-none"
              >
                <Plus aria-hidden className="size-4" /> New job search
              </Link>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
