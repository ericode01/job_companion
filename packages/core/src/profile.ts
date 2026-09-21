import { eq } from "drizzle-orm";
import { getDb, one, returned } from "./db";
import { profile } from "./db/schema";

export type Profile = typeof profile.$inferSelect;
export type ProfileInput = Partial<Pick<Profile, "name" | "email" | "phone" | "location" | "links" | "about" | "writingSample">>;

export async function getProfile(userId: number): Promise<Profile | null> {
  return await one(getDb().select().from(profile).where(eq(profile.userId, userId))) ?? null;
}

export async function saveProfile(userId: number, values: ProfileInput): Promise<Profile> {
  return await returned(
    getDb()
      .insert(profile)
      .values({ userId, ...values })
      .onConflictDoUpdate({ target: profile.userId, set: { ...values, updatedAt: new Date() } })
      .returning(),
  );
}
