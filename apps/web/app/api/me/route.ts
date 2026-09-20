import { ONBOARDING_STEPS } from "@jd/core/schema";
import { getUser, toPublicUser, updateUser } from "@jd/core";
import { z } from "zod";
import { json, readJson, withUser } from "@/lib/api";

export function GET(req: Request) {
  return withUser(req, (user) => json({ user }));
}

const Patch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  timezone: z.string().max(80).optional(),
  onboardingStep: z.enum(ONBOARDING_STEPS).nullable().optional(),
});

export function PATCH(req: Request) {
  return withUser(req, async (user) => {
    updateUser(user.id, Patch.parse(await readJson(req)));
    return json({ user: toPublicUser(getUser(user.id)!) });
  });
}
