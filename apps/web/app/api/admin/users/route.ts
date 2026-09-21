import { listUsers, spendByUser } from "@jd/core";
import { getDb, schema } from "@jd/core/db";
import { count, isNull } from "drizzle-orm";
import { json, withAdmin } from "@/lib/api";

export function GET(req: Request) {
  return withAdmin(req, async () => {
    const db = getDb();
    const spend = new Map((await spendByUser()).map((s) => [s.userId, s.usd]));
    const searches = new Map(
      (
        await db
          .select({ userId: schema.savedSearch.userId, n: count() })
          .from(schema.savedSearch)
          .where(isNull(schema.savedSearch.archivedAt))
          .groupBy(schema.savedSearch.userId)
      ).map((r) => [r.userId, r.n]),
    );
    const apps = new Map(
      (
        await db
          .select({ userId: schema.application.userId, n: count() })
          .from(schema.application)
          .groupBy(schema.application.userId)
      ).map((r) => [r.userId, r.n]),
    );
    return json(
      (await listUsers()).map(({ passwordHash: _p, ...u }) => ({
        ...u,
        monthSpendUsd: spend.get(u.id) ?? 0,
        searches: searches.get(u.id) ?? 0,
        applications: apps.get(u.id) ?? 0,
      })),
    );
  });
}
