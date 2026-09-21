import { getProfile, saveProfile } from "@jd/core";
import { z } from "zod";
import { json, readJson, withUser } from "@/lib/api";

const opt = z.string().trim().max(300).optional().transform((v) => v || null);
const long = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);

/** Contact details plus "about you" and a writing sample. Partial updates are allowed. */
const Profile = z
  .object({
    name: opt,
    email: z.union([z.literal(""), z.string().trim().email("Enter a valid email.")]).optional().transform((v) => v || null),
    phone: opt,
    location: opt,
    links: z.object({ linkedin: z.string().trim().optional(), github: z.string().trim().optional(), site: z.string().trim().optional() }),
    about: long(8000),
    writingSample: long(20000),
  })
  .partial();

const EMPTY = { name: null, email: null, phone: null, location: null, links: {}, about: null, writingSample: null };

export function GET(req: Request) {
  return withUser(req, async (user) => json(await getProfile(user.id) ?? EMPTY));
}

export function PUT(req: Request) {
  return withUser(req, async (user) => {
    const raw = (await readJson(req)) as Record<string, unknown>;
    const parsed = Profile.parse(raw);
    // Only fields that were sent are written, so onboarding can save "about you" alone.
    const values = Object.fromEntries(Object.entries(parsed).filter(([k]) => k in raw));
    return json(await saveProfile(user.id, values));
  });
}
