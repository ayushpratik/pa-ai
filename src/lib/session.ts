import "server-only";
import { redirect } from "next/navigation";
import { getSessionUser, type SessionUser } from "@/lib/auth";
import { getProfile } from "@/lib/profile";
import { isProfileComplete, type ProfileFields } from "@/lib/types";

export class UnauthorizedError extends Error {
  constructor() {
    super("Not signed in.");
    this.name = "UnauthorizedError";
  }
}

export async function getUserId(): Promise<string | null> {
  const user = await getSessionUser();
  return user?.id ?? null;
}

/** For API routes: throws, and the caller turns that into a 401. */
export async function requireUserId(): Promise<string> {
  const userId = await getUserId();
  if (!userId) throw new UnauthorizedError();
  return userId;
}

/**
 * The gate for every signed-in page. Redirects rather than throwing, because
 * these callers are server components where a redirect is the right response.
 */
export async function requireOnboardedUser(): Promise<{
  user: SessionUser;
  profile: ProfileFields;
}> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const profile = await getProfile(user.id);
  if (!isProfileComplete(profile)) redirect("/onboarding");

  return { user, profile };
}

/**
 * Wraps an API route handler so every one of them rejects an anonymous caller
 * identically, instead of repeating the same try/catch ten times.
 */
export function withUser<Args extends unknown[]>(
  handler: (userId: string, ...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    let userId: string;
    try {
      userId = await requireUserId();
    } catch {
      return Response.json({ error: "Not signed in" }, { status: 401 });
    }
    return handler(userId, ...args);
  };
}
