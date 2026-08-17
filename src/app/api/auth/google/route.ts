import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { OAUTH_STATE_COOKIE } from "@/lib/auth";
import { env } from "@/lib/env";
import { googleOAuthClient } from "@/lib/google-oauth";

export const runtime = "nodejs";

// Sign-in only. Deliberately no gmail.send here: sending is a separate,
// opt-in consent from Settings, so signing in never asks for mailbox access.
const LOGIN_SCOPES = ["openid", "email", "profile"];

export async function GET() {
  try {
    const state = randomBytes(24).toString("base64url");

    // Build the URL first: when OAuth is unconfigured this throws, and setting
    // the cookie beforehand would leave a stray one behind on every attempt.
    const url = googleOAuthClient(env.googleLoginRedirectUri).generateAuthUrl({
      scope: LOGIN_SCOPES,
      state,
      // Ask every time which account to use, so a shared browser does not
      // silently sign in as whoever was last active.
      prompt: "select_account",
    });

    const store = await cookies();
    store.set(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 10 * 60,
    });

    return Response.redirect(url, 302);
  } catch (error) {
    console.error("Google login consent URL failed", error);
    return Response.redirect(
      new URL("/login?error=google_unavailable", env.appUrl),
      302,
    );
  }
}
