import { getUserSettings } from "@jd/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardDigest } from "@/components/DashboardDigest";
import { dashboardName, getDashboard } from "@/lib/dashboards";
import { requirePageUser } from "@/lib/session";

export const metadata: Metadata = { title: "Email digest" };

export default async function DashboardDigestPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const d = await getDashboard(user.id, Number((await params).id));
  if (!d) notFound();
  const digest = await getUserSettings(user.id, "digest");
  return (
    <DashboardDigest
      dashboardId={d.id}
      name={dashboardName(d)}
      notify={d.notify}
      digestMinFit={d.digestMinFit}
      account={{ enabled: digest.enabled, to: digest.to, sendTime: digest.sendTime, minFitScore: digest.minFitScore, timezone: user.timezone }}
    />
  );
}
