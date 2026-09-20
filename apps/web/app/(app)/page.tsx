import { redirect } from "next/navigation";
import { listDashboards } from "@/lib/dashboards";
import { requirePageUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Home is your most recent dashboard, or "new search" if you have none. */
export default async function Home() {
  const user = await requirePageUser();
  const dashboards = listDashboards(user.id);
  const target = dashboards.find((d) => d.id === user.lastSearchId) ?? dashboards.at(-1);
  redirect(target ? `/d/${target.id}` : "/searches/new");
}
