"use client";

import type { SearchFilter } from "@jd/core/shared";
import { Archive, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { FilterEditor } from "@/components/FilterEditor";
import { Alert, ConfirmDialog } from "@/components/ui";
import { describeFilter } from "@/lib/filters";

export function DashboardEditor({ id, name: initialName, rawQuery, filter: initialFilter }: { id: number; name: string; rawQuery: string; filter: SearchFilter }) {
  const router = useRouter();
  const nameId = useId();
  const [name, setName] = useState(initialName);
  const [filter, setFilter] = useState(initialFilter);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | "archive" | "delete">(null);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/searches/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim() || null, filter }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Couldn't save. Check the fields and try again.");
      return;
    }
    router.push(`/d/${id}`);
    router.refresh();
  }

  async function remove(kind: "archive" | "delete") {
    setConfirm(null);
    const res =
      kind === "archive"
        ? await fetch(`/api/searches/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ archived: true }) })
        : await fetch(`/api/searches/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("That didn't work. Try again.");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="space-y-5">
      {error && <Alert tone="danger">{error}</Alert>}
      <section className="card space-y-5 p-5 sm:p-6" aria-labelledby="edit-title">
        <div>
          <h2 id="edit-title" className="section-title">
            Search details
          </h2>
          <p className="text-sm text-muted">
            Started from “{rawQuery}”. Currently finding: <span className="text-text first-letter:uppercase">{describeFilter(filter)}</span>.
          </p>
        </div>
        <div className="max-w-md">
          <label htmlFor={nameId} className="label">
            Dashboard name
          </label>
          <input id={nameId} className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </div>
        <FilterEditor filter={filter} onChange={setFilter} />
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button className="btn" onClick={() => router.back()}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => void save()} disabled={busy || filter.roleKeywords.length === 0}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </section>

      <section className="card space-y-3 p-5 sm:p-6" aria-labelledby="done-title">
        <h2 id="done-title" className="section-title">
          Finished with this search?
        </h2>
        <p className="text-sm text-muted">
          Archiving hides it from the switcher and stops its emails; its applications stay in your account. Deleting also removes its
          saved matches.
        </p>
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={() => setConfirm("archive")}>
            <Archive aria-hidden className="size-4" /> Archive
          </button>
          <button className="btn-danger" onClick={() => setConfirm("delete")}>
            <Trash2 aria-hidden className="size-4" /> Delete
          </button>
        </div>
      </section>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "delete" ? "Delete this search?" : "Archive this search?"}
        body={
          confirm === "delete"
            ? `“${name}” and its matches will be deleted. Applications you made from it stay in your account and move to another search.`
            : `“${name}” leaves the switcher and your daily email. Nothing is deleted.`
        }
        confirmLabel={confirm === "delete" ? "Delete" : "Archive"}
        danger={confirm === "delete"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void remove(confirm!)}
      />
    </div>
  );
}
