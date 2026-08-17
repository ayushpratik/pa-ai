import { cookies } from "next/headers";
import { google } from "googleapis";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { oauthAccounts } from "@/db/schema";
import { createSession, OAUTH_STATE_COOKIE } from "@/lib/auth";
import { createUser, findUserByEmail, updateUser } from "@/lib/accounts";
import { env } from "@/lib/env";
import { googleOAuthClient } from "@/lib/google-oauth";

export const runtime = "nodejs";

// Distinct from the "google" rows lib/gmail.ts writes for sending: this row is
// an identity, not a send credential.
const PROVIDER = "google-login";

function backToLogin(origin: string, reason: string) {
  return Response.redirect(new URL(`/login?error=${reason}`, origin), 302);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const store = await cookies();

  // The state check must come first. Without it anyone can feed this endpoint a
  // code and sign the visitor into an account they control.
  const expectedState = store.get(OAUTH_STATE_COOKIE)?.value;
  store.delete(OAUTH_STATE_COOKIE);

  const state = url.searchParams.get("state");
  if (!expectedState || !state || state !== expectedState) {
    return backToLogin(origin, "invalid_state");
  }

  if (url.searchParams.get("error")) return backToLogin(origin, "cancelled");
  const code = url.searchParams.get("code");
  if (!code) return backToLogin(origin, "missing_code");

  try {
    const client = googleOAuthClient(env.googleLoginRedirectUri);
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const info = await google
      .oauth2({ version: "v2", auth: client })
      .userinfo.get();
    const email = info.data.email;
    if (!email || info.data.verified_email === false) {
      return backToLogin(origin, "unverified_email");
    }

    // Resolve in three steps: a Google identity seen before, then an existing
    // password account with the same address (linked, not duplicated), then a
    // brand-new account.
    const [identity] = await db
      .select({ userId: oauthAccounts.userId })
      .from(oauthAccounts)
      .where(
        and(
          eq(oauthAccounts.provider, PROVIDER),
          eq(oauthAccounts.accountEmail, email),
        ),
      )
      .limit(1);

    let userId = identity?.userId ?? null;

    if (!userId) {
      const existing = await findUserByEmail(email);
      userId =
        existing?.id ??
        (
          await createUser({
            email,
            name: info.data.name ?? null,
            imageUrl: info.data.picture ?? null,
          })
        ).id;
    }

    if (info.data.name) {
      await updateUser(userId, {
        name: info.data.name,
        imageUrl: info.data.picture ?? null,
      });
    }

    await db
      .insert(oauthAccounts)
      .values({
        userId,
        provider: PROVIDER,
        accountEmail: email,
        accessToken: tokens.access_token ?? "",
        refreshToken: tokens.refresh_token ?? null,
        scope: tokens.scope ?? null,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        revoked: false,
      })
      .onConflictDoUpdate({
        target: [oauthAccounts.userId, oauthAccounts.provider],
        set: {
          accountEmail: email,
          accessToken: tokens.access_token ?? "",
          scope: tokens.scope ?? null,
          expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
          revoked: false,
          updatedAt: new Date(),
        },
      });

    await createSession(userId);

    // /onboarding forwards to /chat when the profile is already complete, so
    // this one target is right for both a new and a returning account.
    return Response.redirect(new URL("/onboarding", origin), 302);
  } catch (error) {
    console.error("Google sign-in failed", error);
    return backToLogin(origin, "failed");
  }
}
