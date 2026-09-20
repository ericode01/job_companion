import { getExtensionState, pendingInboxCount } from "@jd/apply";
import { activeConnections, openActions, reviewQueue } from "@jd/mail";
import { Suspense } from "react";
import { AppNav } from "@/components/AppNav";
import { Brand } from "@/components/Brand";
import { DashboardSwitcher } from "@/components/DashboardSwitcher";
import { UserMenu } from "@/components/UserMenu";
import { assignOrphanApplications, listDashboards } from "@/lib/dashboards";
import { requirePageUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  // Applications from before dashboards (or from a job opened elsewhere) get a home pipeline.
  assignOrphanApplications(user.id);
  const dashboards = listDashboards(user.id).map(({ id, name, newCount }) => ({ id, name, newCount }));
  const ext = getExtensionState(user.id);
  const connected = Boolean(ext.lastSeenAt && Date.now() - ext.lastSeenAt.getTime() < 7 * 86_400_000);
  const inbox = pendingInboxCount(user.id);
  const actions = openActions(user.id).length;
  const boxes = activeConnections(user.id);
  const mailbox = {
    state: boxes.length === 0 ? ("none" as const) : boxes.some((b) => b.status === "needs_reauth" || b.status === "error") ? ("attention" as const) : ("ok" as const),
    review: reviewQueue(user.id).length,
  };

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:gap-3">
          <Brand compact />
          <span aria-hidden className="hidden h-6 w-px bg-border md:block" />
          <Suspense>
            <DashboardSwitcher dashboards={dashboards} lastId={user.lastSearchId} />
          </Suspense>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <AppNav inbox={inbox} actions={actions} extensionConnected={connected} mailbox={mailbox} />
            <UserMenu name={user.name} email={user.email} isAdmin={user.role === "admin"} inbox={inbox} actions={actions} mailbox={mailbox} />
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-6 focus:outline-none">
        {children}
      </main>
    </>
  );
}
