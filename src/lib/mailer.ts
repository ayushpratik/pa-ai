import "server-only";
import { env } from "@/lib/env";
import { deliverViaGmail, getGoogleConnection } from "@/lib/gmail";
import { deliverViaSmtp, isSmtpConfigured } from "@/lib/smtp";
import type { EmailStatus, SendEmailMode } from "@/lib/types";

export type SendResult = {
  mode: SendEmailMode;
  transport: "smtp" | "gmail" | "none";
  delivered: boolean;
  actualRecipient: string | null;
  intendedRecipient: string;
  messageId?: string;
  note: string;
};

/**
 * Resolves the configured transport preference to the one that can actually
 * send right now. "auto" prefers SMTP because it needs no interactive consent.
 */
async function resolveTransport(userId: string): Promise<"smtp" | "gmail" | "none"> {
  const preference = env.emailTransport;

  if (preference === "smtp") return isSmtpConfigured() ? "smtp" : "none";
  if (preference === "gmail") {
    return (await getGoogleConnection(userId)).connected ? "gmail" : "none";
  }

  if (isSmtpConfigured()) return "smtp";
  return (await getGoogleConnection(userId)).connected ? "gmail" : "none";
}

export async function getEmailStatus(userId: string): Promise<EmailStatus> {
  const google = await getGoogleConnection(userId);
  const smtp = env.smtp;

  return {
    transport: env.emailTransport,
    resolved: await resolveTransport(userId),
    smtpConfigured: smtp !== null,
    smtpHost: smtp ? `${smtp.host}:${smtp.port}` : null,
    smtpFrom: smtp?.from ?? null,
    googleConnected: google.connected,
    googleEmail: google.email,
    googleOAuthConfigured: Boolean(
      env.googleOAuthClientId && env.googleOAuthClientSecret,
    ),
  };
}

/**
 * The single place outbound email leaves this application.
 *
 * SEND_EMAIL is applied here, above both transports, so no caller and no
 * transport can route around it. In "test" mode the real recipient is preserved
 * in the subject and returned to the caller for the audit trail.
 */
export async function sendMail(
  userId: string,
  params: {
    to: string;
    subject: string;
    body: string;
  },
): Promise<SendResult> {
  const mode = env.sendEmailMode;
  const intendedRecipient = params.to;

  if (mode === "none") {
    console.info(
      `[SEND_EMAIL=none] Suppressed email to ${intendedRecipient} - "${params.subject}"`,
    );
    return {
      mode,
      transport: "none",
      delivered: false,
      actualRecipient: null,
      intendedRecipient,
      note: "Not sent: SEND_EMAIL is set to none.",
    };
  }

  const isTest = mode === "test";
  const recipient = isTest ? env.testEmailRecipient : intendedRecipient;
  const subject = isTest
    ? `[TEST -> ${intendedRecipient}] ${params.subject}`
    : params.subject;

  const transport = await resolveTransport(userId);
  if (transport === "none") {
    throw new Error(
      env.emailTransport === "gmail"
        ? "Google is not connected. Open Settings and connect a Google account, or set EMAIL_TRANSPORT=smtp with SMTP credentials."
        : "No email transport is available. Set SMTP_HOST, SMTP_USER and SMTP_PASS in .env.local, or connect Google in Settings.",
    );
  }

  const result =
    transport === "smtp"
      ? await deliverViaSmtp({ to: recipient, subject, body: params.body })
      : await deliverViaGmail(userId, {
          to: recipient,
          subject,
          body: params.body,
        });

  return {
    mode,
    transport,
    delivered: true,
    actualRecipient: recipient,
    intendedRecipient,
    messageId: result.messageId,
    note: isTest
      ? `Sent via ${transport} to the test inbox (${recipient}) instead of ${intendedRecipient}.`
      : `Sent via ${transport} to ${recipient}.`,
  };
}
