import { getSpendStatus } from "@jd/core";
import { hasApiKey } from "@jd/llm";
import { json, withUser } from "@/lib/api";

/** Your spend today against your own cap; admins also see the system totals. */
export function GET(req: Request) {
  return withUser(req, async (user) => {
    const s = await getSpendStatus(new Date(), user.id);
    const mine = { userTodayUsd: s.userTodayUsd, userDailyCapUsd: s.userDailyCapUsd, overCap: s.overCap, reason: s.reason, hasApiKey: hasApiKey() };
    return json(user.role === "admin" ? { ...s, hasApiKey: hasApiKey() } : mine);
  });
}
