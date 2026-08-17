import "server-only";
import { google } from "googleapis";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { oauthAccounts } from "@/db/schema";
import { env } from "@/lib/env";
import { googleOAuthClient } from "@/lib/google-oauth";

// The sending connection. The sign-in identity is a separate provider row
// ("google-login") written by the auth flow, and carries no send scope.
const PROVIDER = "google";

// gmail.send only. The app never needs to read the user's mailbox, and asking
// for less makes the consent screen far easier to approve.
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email",
];

export class GmailNotConnectedError extends Error {
  constructor() {
    super(
      "Google is not connected. Open Settings and connect a Google account before sending email.",
    );
    this.name = "GmailNotConnectedError";
  }
}

function oauthClient() {
  return googleOAuthClient(env.googleOAuthRedirectUri);
}

export function buildConsentUrl(): string {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    // Without this Google withholds the refresh token on repeat consents,
    // leaving the connection dead after the first hour.
    prompt: "consent",
    scope: GOOGLE_SCOPES,
  });
}

export async function exchangeCodeAndStore(
  userId: string,
  code: string,
): Promise<void> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  let accountEmail: string | null = null;
  try {
    const info = await google.oauth2({ version: "v2", auth: client }).userinfo.get();
    accountEmail = info.data.email ?? null;
  } catch {
    // Non-fatal: the address is only used for display on the settings page.
  }

  await db
    .insert(oauthAccounts)
    .values({
      userId,
      provider: PROVIDER,
      accountEmail,
      accessToken: tokens.access_token ?? "",
      refreshToken: tokens.refresh_token ?? null,
      scope: tokens.scope ?? null,
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      revoked: false,
    })
    .onConflictDoUpdate({
      target: [oauthAccounts.userId, oauthAccounts.provider],
      set: {
        accountEmail,
        accessToken: tokens.access_token ?? "",
        // Google omits the refresh token on re-consent in some flows; keeping
        // the stored one is better than nulling a working credential.
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
        scope: tokens.scope ?? null,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        revoked: false,
        updatedAt: new Date(),
      },
    });
}

export async function getGoogleConnection(userId: string): Promise<{
  connected: boolean;
  email: string | null;
}> {
  const [row] = await db
    .select()
    .from(oauthAccounts)
    .where(
      and(
        eq(oauthAccounts.userId, userId),
        eq(oauthAccounts.provider, PROVIDER),
      ),
    )
    .limit(1);

  if (!row || row.revoked) return { connected: false, email: null };
  return { connected: true, email: row.accountEmail };
}

async function authorizedClient(userId: string) {
  const [row] = await db
    .select()
    .from(oauthAccounts)
    .where(
      and(
        eq(oauthAccounts.userId, userId),
        eq(oauthAccounts.provider, PROVIDER),
      ),
    )
    .limit(1);

  if (!row || row.revoked) throw new GmailNotConnectedError();

  const client = oauthClient();
  client.setCredentials({
    access_token: row.accessToken,
    refresh_token: row.refreshToken ?? undefined,
    expiry_date: row.expiresAt?.getTime(),
  });

  // The library refreshes on demand; persist whatever it hands back so the next
  // request does not have to refresh again.
  client.on("tokens", (tokens) => {
    void db
      .update(oauthAccounts)
      .set({
        ...(tokens.access_token ? { accessToken: tokens.access_token } : {}),
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
        ...(tokens.expiry_date
          ? { expiresAt: new Date(tokens.expiry_date) }
          : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(oauthAccounts.userId, userId),
          eq(oauthAccounts.provider, PROVIDER),
        ),
      )
      .catch((error) => console.error("Failed to persist refreshed token", error));
  });

  return { client, accountEmail: row.accountEmail };
}

function encodeHeader(value: string): string {
  // RFC 2047 for non-ASCII subjects; plain ASCII passes through untouched.
  return /^[\x20-\x7E]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function buildRawMessage(params: {
  from: string;
  to: string;
  subject: string;
  body: string;
}): string {
  const message = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    `Subject: ${encodeHeader(params.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(params.body, "utf8").toString("base64"),
  ].join("\r\n");

  return Buffer.from(message, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Raw delivery through the connected Google account.
 *
 * The SEND_EMAIL guard lives in lib/mailer.ts, above this and the SMTP
 * transport, so neither can be called in a way that bypasses it. Do not add
 * recipient rewriting here.
 */
export async function deliverViaGmail(
  userId: string,
  params: {
    to: string;
    subject: string;
    body: string;
  },
): Promise<{ messageId?: string; from: string }> {
  const { client, accountEmail } = await authorizedClient(userId);
  const gmail = google.gmail({ version: "v1", auth: client });

  const response = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: buildRawMessage({
        from: accountEmail ?? "me",
        to: params.to,
        subject: params.subject,
        body: params.body,
      }),
    },
  });

  return {
    messageId: response.data.id ?? undefined,
    from: accountEmail ?? "me",
  };
}
