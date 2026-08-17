import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "@/lib/env";

export class SmtpNotConfiguredError extends Error {
  constructor() {
    super(
      "SMTP is not configured. Set SMTP_HOST, SMTP_USER and SMTP_PASS in .env.local, or connect Google in Settings.",
    );
    this.name = "SmtpNotConfiguredError";
  }
}

// Next dev reloads modules on every edit; caching on globalThis keeps one pool
// instead of opening a fresh connection per reload, matching db/index.ts.
const globalForSmtp = globalThis as unknown as {
  smtpTransporter?: Transporter;
  smtpKey?: string;
};

function transporter(): Transporter {
  const config = env.smtp;
  if (!config) throw new SmtpNotConfiguredError();

  // Rebuild when the settings change rather than serving a stale connection.
  const key = `${config.host}:${config.port}:${config.user}:${config.secure}`;
  if (globalForSmtp.smtpTransporter && globalForSmtp.smtpKey === key) {
    return globalForSmtp.smtpTransporter;
  }

  const created = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
  });

  globalForSmtp.smtpTransporter = created;
  globalForSmtp.smtpKey = key;
  return created;
}

export function isSmtpConfigured(): boolean {
  return env.smtp !== null;
}

/**
 * Raw delivery. The SEND_EMAIL guard lives in lib/mailer.ts, above this and the
 * Gmail transport, so neither can be called in a way that bypasses it.
 */
export async function deliverViaSmtp(params: {
  to: string;
  subject: string;
  body: string;
}): Promise<{ messageId?: string; from: string }> {
  const config = env.smtp;
  if (!config) throw new SmtpNotConfiguredError();

  const info = await transporter().sendMail({
    from: config.from,
    to: params.to,
    subject: params.subject,
    text: params.body,
  });

  return { messageId: info.messageId, from: config.from };
}

/** Used by the settings screen to check credentials without sending anything. */
export async function verifySmtp(): Promise<{ ok: boolean; error?: string }> {
  try {
    await transporter().verify();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "SMTP verification failed",
    };
  }
}
