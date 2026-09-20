import { Settings2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanionCard } from "@/components/CompanionCard";
import { DashboardTabs } from "@/components/DashboardTabs";
import { companionSteps, dashboardName, getDashboard, sinceLastVisit } from "@/lib/dashboards";
import { describeFilter } from "@/lib/filters";
import { requirePageUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const d = getDashboard(user.id, Number((await params).id));
  if (!d || d.archivedAt) notFound();
  const steps = companionSteps(user, d, sinceLastVisit(user.id, d));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-balance">{dashboardName(d)}</h1>
          <p className="text-sm text-muted first-letter:uppercase">{describeFilter(d.filter)}</p>
        </div>
        <Link href={`/d/${d.id}/edit`} className="btn">
          <Settings2 aria-hidden className="size-4" /> Edit search
        </Link>
      </div>
      <CompanionCard steps={steps} />
      <DashboardTabs id={d.id} digestOn={d.notify} />
      {children}
    </div>
  );
}
