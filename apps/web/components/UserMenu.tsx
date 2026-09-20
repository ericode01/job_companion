"use client";

import { LogOut, Puzzle, Settings, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

export function UserMenu({ name, email, isAdmin }: { name: string; email: string; isAdmin: boolean }) {
  const router = useRouter();
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    root.current?.querySelector<HTMLElement>("[data-first]")?.focus();
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Account menu for ${name}`}
        onClick={() => setOpen((o) => !o)}
        className="grid size-10 place-items-center rounded-full border border-border bg-surface-2 text-sm font-semibold transition-colors hover:border-border-strong"
      >
        {initials || "?"}
      </button>
      {open && (
        <div id={menuId} className="absolute top-full right-0 z-50 mt-1.5 w-64 rounded-xl border border-border bg-surface p-1.5 shadow-lg">
          <div className="px-2.5 py-2">
            <p className="truncate text-sm font-semibold">{name}</p>
            <p className="truncate text-xs text-muted">{email}</p>
          </div>
          {/* Pipeline, Answers and Mailbox are in the bottom bar on phones; these are the rest. */}
          <div className="border-t border-border py-1 sm:hidden">
            <Link href="/profile" className="flex min-h-11 items-center gap-2 rounded-lg px-2.5 text-sm hover:bg-surface-2 focus:bg-surface-2 focus:outline-none" onClick={() => setOpen(false)}>
              <UserRound aria-hidden className="size-4 text-muted" /> Profile
            </Link>
            <Link href="/extension" className="flex min-h-11 items-center gap-2 rounded-lg px-2.5 text-sm hover:bg-surface-2 focus:bg-surface-2 focus:outline-none" onClick={() => setOpen(false)}>
              <Puzzle aria-hidden className="size-4 text-muted" /> Chrome extension
            </Link>
          </div>
          <div className="border-t border-border pt-1">
            <Link data-first href="/account" className="flex min-h-10 items-center gap-2 rounded-lg px-2.5 text-sm hover:bg-surface-2 focus:bg-surface-2 focus:outline-none" onClick={() => setOpen(false)}>
              <Settings aria-hidden className="size-4 text-muted" /> Account and email
            </Link>
            {isAdmin && (
              <Link href="/admin" className="flex min-h-10 items-center gap-2 rounded-lg px-2.5 text-sm hover:bg-surface-2 focus:bg-surface-2 focus:outline-none" onClick={() => setOpen(false)}>
                <ShieldCheck aria-hidden className="size-4 text-muted" /> Admin portal
              </Link>
            )}
            <button type="button" onClick={signOut} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-sm hover:bg-surface-2 focus:bg-surface-2 focus:outline-none">
              <LogOut aria-hidden className="size-4 text-muted" /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
