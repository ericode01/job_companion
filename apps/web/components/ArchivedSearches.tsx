"use client";

import { ArchiveRestore } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { timeAgo } from "@/lib/format";

export function ArchivedSearches({ items }: { items: { id: number; name: string; archivedAt: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  return (
    <ul className="divide-y divide-border rounded-lg border border-border text-sm">
      {items.map((d) => (
        <li key={d.id} className="flex items-center gap-3 px-3 py-2">
          <span className="min-w-0 flex-1 truncate">{d.name}</span>
          <span className="shrink-0 text-muted">archived {timeAgo(d.archivedAt)}</span>
          <button
            className="btn min-h-8 shrink-0 px-2.5"
            disabled={busy !== null}
            onClick={async () => {
              setBusy(d.id);
              await fetch(`/api/searches/${d.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ archived: false }) });
              router.push(`/d/${d.id}`);
              router.refresh();
            }}
          >
            <ArchiveRestore aria-hidden className="size-4" /> Restore
          </button>
        </li>
      ))}
    </ul>
  );
}
