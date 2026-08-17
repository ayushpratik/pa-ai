import "server-only";
import { google } from "googleapis";
import { env } from "@/lib/env";

/**
 * One place the OAuth client credentials are read.
 *
 * Two flows use the same Google client with different redirect URIs and very
 * different scopes: sign-in (profile + email) and Gmail sending (gmail.send).
 * Keeping the construction here stops the two from drifting apart on
 * credentials while remaining explicit about which redirect each one uses.
 */
export function googleOAuthClient(redirectUri: string) {
  const clientId = env.googleOAuthClientId;
  const clientSecret = env.googleOAuthClientSecret;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Google OAuth is not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.",
    );
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}
