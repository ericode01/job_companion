import { getDb, one, schema } from "@jd/core/db";
import { ensureJobDetail } from "@jd/sources";
import { dashboardName, getDashboard } from "@/lib/dashboards";
import { requirePageUser } from "@/lib/session";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import sanitizeHtml from "sanitize-html";
import { JobView } from "./JobView";

export const dynamic = "force-dynamic";

export default async function JobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ d?: string }>;
}) {
  const user = await requirePageUser();
  const id = Number((await params).id);
  const d = await getDashboard(user.id, Number((await searchParams).d ?? user.lastSearchId ?? NaN));
  // Workday and SmartRecruiters postings are stored without their description; fetch it now.
  await ensureJobDetail(id);
  const row = await one(getDb().select({ html: schema.job.descriptionHtml }).from(schema.job).where(eq(schema.job.id, id)));
  if (!row) notFound();
  // Postings come from third-party job boards: strip scripts, styles, images, and event handlers.
  const html = sanitizeHtml(row.html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.filter((t) => t !== "img"),
    allowedAttributes: { a: ["href"] },
    transformTags: { a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noreferrer" }) },
  });
  return (
    <JobView id={id} dashboard={d ? { id: d.id, name: dashboardName(d) } : null}>
      <div className="card prose-job p-5 text-[15px] leading-relaxed sm:p-6" dangerouslySetInnerHTML={{ __html: html }} />
    </JobView>
  );
}
