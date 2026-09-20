import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { profile } from "./db/schema";

export type Profile = typeof profile.$inferSelect;
export type ProfileInput = Partial<Pick<Profile, "name" | "email" | "phone" | "location" | "links" | "about" | "writingSample">>;

export function getProfile(userId: number): Profile | null {
  return getDb().select().from(profile).where(eq(profile.userId, userId)).get() ?? null;
}

export function saveProfile(userId: number, values: ProfileInput): Profile {
  return getDb()
    .insert(profile)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: profile.userId, set: { ...values, updatedAt: new Date() } })
    .returning()
    .get();
}
