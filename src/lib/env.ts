/**
 * Server-side environment configuration.
 *
 * Reading a variable through this module throws immediately with an actionable
 * message when it is missing, rather than surfacing as an opaque failure on the
 * first request. Never import this from a client component.
 */

import type { EmailTransport, SendEmailMode } from "@/lib/types";

export type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  secure: boolean;
  from: string;
};

const EMAIL_TRANSPORTS: EmailTransport[] = ["auto", "smtp", "gmail"];

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

const SEND_EMAIL_MODES: SendEmailMode[] = ["none", "test", "send"];

export const env = {
  get googleApiKey(): string {
    return required("GOOGLE_GENERATIVE_AI_API_KEY");
  },
  get geminiModel(): string {
    return process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite";
  },
  get databaseUrl(): string {
    return required("DATABASE_URL");
  },

  /**
   * Pepper for session-token hashing. Rotating it invalidates every live
   * session, which is the intended emergency lever.
   */
  get authSecret(): string {
    return required("AUTH_SECRET");
  },
  /** Public origin, used to build OAuth redirect URIs. */
  get appUrl(): string {
    return optional("APP_URL") ?? "http://localhost:3000";
  },

  /** Serper-compatible web search. Absent means the web search tool is disabled. */
  get searchApiKey(): string | undefined {
    return optional("SEARCH_API_KEY");
  },
  /** Absent means the Apollo tools are not registered at all. */
  get apolloApiKey(): string | undefined {
    return optional("APOLLO_API_KEY");
  },

  get googleOAuthClientId(): string | undefined {
    return optional("GOOGLE_OAUTH_CLIENT_ID");
  },
  get googleOAuthClientSecret(): string | undefined {
    return optional("GOOGLE_OAUTH_CLIENT_SECRET");
  },
  /**
   * Where Google returns after the *sending* consent (gmail.send). Distinct
   * from the login callback below: one asks "may I send mail as you", the other
   * asks "who are you", and they carry different scopes.
   */
  get googleOAuthRedirectUri(): string {
    return (
      optional("GOOGLE_OAUTH_REDIRECT_URI") ??
      `${env.appUrl}/api/integrations/google/callback`
    );
  },
  /** Where Google returns after the login consent (profile + email only). */
  get googleLoginRedirectUri(): string {
    return (
      optional("GOOGLE_LOGIN_REDIRECT_URI") ??
      `${env.appUrl}/api/auth/google/callback`
    );
  },
  /** Google login is only offered when an OAuth client is configured. */
  get googleLoginEnabled(): boolean {
    return Boolean(env.googleOAuthClientId && env.googleOAuthClientSecret);
  },

  /**
   * Which transport delivers mail. "auto" prefers SMTP when it is configured
   * and falls back to the Gmail OAuth connection, which keeps the simple local
   * setup working without giving up the send-as-the-user path.
   */
  get emailTransport(): EmailTransport {
    const value = optional("EMAIL_TRANSPORT")?.toLowerCase();
    return EMAIL_TRANSPORTS.includes(value as EmailTransport)
      ? (value as EmailTransport)
      : "auto";
  },

  get smtp(): SmtpConfig | null {
    const host = optional("SMTP_HOST");
    const user = optional("SMTP_USER");
    const password = optional("SMTP_PASS");
    // Host alone is not enough to send; treat a partial config as absent so the
    // transport selection falls through rather than failing at send time.
    if (!host || !user || !password) return null;

    const port = Number(optional("SMTP_PORT") ?? 587);
    return {
      host,
      port: Number.isFinite(port) ? port : 587,
      user,
      password,
      // Implicit TLS on 465; STARTTLS on everything else.
      secure: optional("SMTP_SECURE")?.toLowerCase() === "true" || port === 465,
      from: optional("SMTP_FROM") ?? user,
    };
  },

  /**
   * Guards every outbound email. Defaults to "none" so a fresh checkout, a CI
   * run, or a forgotten variable can never mail a real prospect.
   */
  get sendEmailMode(): SendEmailMode {
    const value = optional("SEND_EMAIL")?.toLowerCase();
    return SEND_EMAIL_MODES.includes(value as SendEmailMode)
      ? (value as SendEmailMode)
      : "none";
  },
  /** Every recipient is rewritten to this address when SEND_EMAIL=test. */
  get testEmailRecipient(): string {
    return optional("TEST_EMAIL_RECIPIENT") ?? "variyakishita@gmail.com";
  },
};
