import { getUserSettings } from "@jd/core";
import type { Metadata } from "next";
import { countOpenJobs } from "@jd/sources";
import { requirePageUser } from "@/lib/session";
import { NewSearch } from "./NewSearch";

export const metadata: Metadata = { title: "New job search" };

export default async function NewSearchPage() {
  const user = await requirePageUser();
  const { jobs, companies } = countOpenJobs();
  return (
    <div className="mx-auto max-w-2xl space-y-6 pt-2 sm:pt-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-balance">Start a new job search</h1>
        <p className="text-muted">
          Each search gets its own dashboard — jobs, pipeline and email — so you can run several without mixing them up.
          I&apos;m watching <span className="tabular-nums">{jobs.toLocaleString()}</span> open roles at{" "}
          <span className="tabular-nums">{companies}</span> companies.
        </p>
      </div>
      <NewSearch defaultRemote={getUserSettings(user.id, "search").includeRemoteUS} />
    </div>
  );
}
