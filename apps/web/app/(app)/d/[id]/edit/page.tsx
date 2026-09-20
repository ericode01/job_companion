import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardEditor } from "@/components/DashboardEditor";
import { dashboardName, getDashboard } from "@/lib/dashboards";
import { requirePageUser } from "@/lib/session";

export const metadata: Metadata = { title: "Edit search" };

export default async function EditDashboard({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const d = getDashboard(user.id, Number((await params).id));
  if (!d) notFound();
  return <DashboardEditor id={d.id} name={dashboardName(d)} rawQuery={d.rawQuery} filter={d.filter} />;
}
