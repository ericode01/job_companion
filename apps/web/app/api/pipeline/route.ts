import { activeConnections, emailChangesSince, openActions, reviewQueue } from "@jd/mail";
import { json, withUser } from "@/lib/api";
import { pipelineFor, pipelineSearches } from "@/lib/dashboards";

/**
 * The pipeline: every application you're tracking, what email asks of you, what it changed this
 * week, and what to check. One board for the person; the search is a filter the browser applies.
 */
export function GET(req: Request) {
  return withUser(req, async (user) => {
    const mailboxes = activeConnections(user.id);
    return json({
      cards: pipelineFor(user.id),
      searches: pipelineSearches(user.id),
      actions: openActions(user.id),
      review: reviewQueue(user.id),
      changes: emailChangesSince(user.id, new Date(Date.now() - 7 * 86_400_000)),
      mailbox: mailboxes.length ? { connected: true, needsReauth: mailboxes.some((c) => c.status === "needs_reauth") } : { connected: false, needsReauth: false },
    });
  });
}
