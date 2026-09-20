import { Suspense } from "react";
import { JobsTab } from "@/components/JobsTab";
import { SkeletonList } from "@/components/ui";

export default async function DashboardJobs({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  return (
    <Suspense fallback={<SkeletonList rows={8} />}>
      <JobsTab dashboardId={id} />
    </Suspense>
  );
}
