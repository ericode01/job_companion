"use client";

import { KanbanSquare, Mails } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EmailTimeline } from "@/components/EmailTimeline";
import { RoundTracker } from "@/components/RoundTracker";
import type { PanelData } from "@/lib/pipeline-types";

/** On a job's page: the emails about your application to it, with rounds and what to do next. */
export function JobEmails({ applicationId, version }: { applicationId: number; version: string }) {
  const [data, setData] = useState<PanelData | null>(null);
  const load = useCallback(async () => {
    const res = await fetch(`/api/pipeline/${applicationId}`);
    if (res.ok) setData(await res.json());
  }, [applicationId]);
  useEffect(() => {
    void load();
  }, [load, version]);

  if (!data || data.emails.length === 0) return null;
  const { app } = data;
  return (
    <section aria-labelledby="job-emails" className="card space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Mails aria-hidden className="size-4 text-accent" />
        <h2 id="job-emails" className="section-title flex-1">
          Your application, from email
        </h2>
        {app.searchId && (
          <Link href={`/pipeline?app=${app.id}`} className="btn min-h-9 text-xs">
            <KanbanSquare aria-hidden className="size-3.5" /> Open in pipeline
          </Link>
        )}
      </div>
      <RoundTracker status={app.status} appliedAt={app.appliedAt} confirmedAt={app.confirmedAt} rounds={data.rounds} />
      <EmailTimeline emails={data.emails} rounds={data.rounds} applications={[]} applicationTitle={app.title} onChanged={() => void load()} />
    </section>
  );
}
