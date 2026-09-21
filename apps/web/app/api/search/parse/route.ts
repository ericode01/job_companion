import { getUserSettings } from "@jd/core";
import { parseSearchQuery } from "@jd/llm";
import { z } from "zod";
import { json, readJson, withUser } from "@/lib/api";

const Body = z.object({
  query: z.string().trim().min(2, "Describe the job in a few words.").max(300),
  /** Onboarding asks this directly; otherwise your default from Account applies. */
  includeRemoteUS: z.boolean().optional(),
});

export function POST(req: Request) {
  return withUser(req, async (user) => {
    const { query, includeRemoteUS } = Body.parse(await readJson(req));
    const defaults = await getUserSettings(user.id, "search");
    return json(
      await parseSearchQuery(query, {
        includeRemoteUS: includeRemoteUS ?? defaults.includeRemoteUS,
        postedWithinDays: defaults.postedWithinDays,
      }),
    );
  });
}
