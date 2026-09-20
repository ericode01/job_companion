import "server-only";
import { appOrigin, SESSION_COOKIE, type PublicUser } from "@jd/core";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { sessionUser } from "./api";

/** The signed-in person for this request (memoized per render). */
export const currentUser = cache(sessionUser);

/** For pages: sends you to sign in, or to finish onboarding, as needed. */
export async function requirePageUser(opts: { allowOnboarding?: boolean } = {}): Promise<PublicUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!opts.allowOnboarding && user.onboardingStep) redirect(`/welcome/${user.onboardingStep}`);
  return user;
}

export async function requirePageAdmin(): Promise<PublicUser> {
  const user = await requirePageUser();
  if (user.role !== "admin") redirect("/");
  return user;
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: appOrigin().startsWith("https://"),
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
