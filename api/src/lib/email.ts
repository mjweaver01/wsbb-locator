import nodemailer from "nodemailer";
import { env } from "./env";

export interface SendCoachLoginCodeInput {
  toEmail: string;
  code: string;
}

export interface SendCoachInviteInput {
  toEmail: string;
  code: string;
  /** Optional coach display name for a friendlier greeting. */
  coachName?: string;
  /** Absolute link to the coach access page (ideally with ?email= prefilled). */
  accessUrl: string;
  /** How long the invite code stays valid, in minutes. */
  ttlMinutes: number;
}

/** Render a minutes count as a human phrase (minutes / hours / days). */
function humanizeMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  if (minutes < 60 * 24) {
    const hours = Math.round(minutes / 60);
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const days = Math.round(minutes / (60 * 24));
  return `${days} day${days === 1 ? "" : "s"}`;
}

/**
 * Escape any string before interpolating into HTML email bodies. Login codes
 * are digit-only today, but future templates that interpolate coach names,
 * aliases, or any user-controlled text MUST go through this.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createSmtpTransport() {
  if (!env.smtpHost) throw new Error("SMTP_HOST is required when EMAIL_PROVIDER=smtp");
  if (!env.emailFrom) throw new Error("EMAIL_FROM is required when EMAIL_PROVIDER=smtp");
  return nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: env.smtpUser && env.smtpPass
      ? { user: env.smtpUser, pass: env.smtpPass }
      : undefined,
  });
}

async function sendWithSmtp(opts: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  const transport = createSmtpTransport();
  await transport.sendMail({ from: env.emailFrom, ...opts });
}

async function sendWithResend({
  toEmail,
  code,
}: SendCoachLoginCodeInput): Promise<void> {
  if (!env.resendApiKey) {
    throw new Error("RESEND_API_KEY is required when EMAIL_PROVIDER=resend");
  }
  if (!env.emailFrom) {
    throw new Error("EMAIL_FROM is required when EMAIL_PROVIDER=resend");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.emailFrom,
      to: [toEmail],
      subject: "Your WSBB coach login code",
      text: `Your WSBB coach login code is ${code}. It expires in ${env.coachAuthCodeTtlMinutes} minutes.`,
      html: `<p>Your WSBB coach login code is <strong>${escapeHtml(code)}</strong>.</p><p>This code expires in ${env.coachAuthCodeTtlMinutes} minutes.</p>`,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend request failed (${response.status}): ${body}`);
  }
}

export async function sendCoachLoginCode(
  input: SendCoachLoginCodeInput,
): Promise<void> {
  if (env.emailProvider === "resend") {
    await sendWithResend(input);
    return;
  }

  if (env.emailProvider === "smtp") {
    await sendWithSmtp({
      to: input.toEmail,
      subject: "Your WSBB coach login code",
      text: `Your WSBB coach login code is ${input.code}. It expires in ${env.coachAuthCodeTtlMinutes} minutes.`,
      html: `<p>Your WSBB coach login code is <strong>${escapeHtml(input.code)}</strong>.</p><p>This code expires in ${env.coachAuthCodeTtlMinutes} minutes.</p>`,
    });
    return;
  }

  if (env.emailProvider !== "console") {
    throw new Error(
      `Unsupported EMAIL_PROVIDER "${env.emailProvider}". Use "console", "resend", or "smtp".`,
    );
  }

  console.log(
    `[coach-auth] code for ${input.toEmail}: ${input.code} (EMAIL_PROVIDER=console)`,
  );
}

function buildInviteEmail(input: SendCoachInviteInput): {
  subject: string;
  text: string;
  html: string;
} {
  const validFor = humanizeMinutes(input.ttlMinutes);
  const greetingName = input.coachName?.trim();
  const greeting = greetingName ? `Hi ${greetingName},` : "Hi,";

  const subject = "You're invited to set up your WSBB coach listing";
  const text = [
    greeting,
    "",
    "You've been invited to add yourself to the Westside Barbell certified coach directory.",
    "",
    `1. Open: ${input.accessUrl}`,
    `2. Enter this verification code: ${input.code}`,
    "3. Fill out your bio, photo, and location, then save.",
    "",
    `This code is valid for ${validFor}. If it expires, you can request a new one from the page above.`,
  ].join("\n");

  const safeGreeting = escapeHtml(greeting);
  const html = `
    <p>${safeGreeting}</p>
    <p>You've been invited to add yourself to the <strong>Westside Barbell certified coach directory</strong>.</p>
    <ol>
      <li><a href="${escapeHtml(input.accessUrl)}">Open your coach listing page</a></li>
      <li>Enter this verification code: <strong>${escapeHtml(input.code)}</strong></li>
      <li>Fill out your bio, photo, and location, then save.</li>
    </ol>
    <p>This code is valid for ${escapeHtml(validFor)}. If it expires, you can request a new one from the page above.</p>
  `;

  return { subject, text, html };
}

export async function sendCoachInvite(
  input: SendCoachInviteInput,
): Promise<void> {
  if (env.emailProvider === "resend") {
    if (!env.resendApiKey) {
      throw new Error("RESEND_API_KEY is required when EMAIL_PROVIDER=resend");
    }
    if (!env.emailFrom) {
      throw new Error("EMAIL_FROM is required when EMAIL_PROVIDER=resend");
    }

    const { subject, text, html } = buildInviteEmail(input);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.emailFrom,
        to: [input.toEmail],
        subject,
        text,
        html,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Resend request failed (${response.status}): ${body}`);
    }
    return;
  }

  if (env.emailProvider === "smtp") {
    const { subject, text, html } = buildInviteEmail(input);
    await sendWithSmtp({ to: input.toEmail, subject, text, html });
    return;
  }

  if (env.emailProvider !== "console") {
    throw new Error(
      `Unsupported EMAIL_PROVIDER "${env.emailProvider}". Use "console", "resend", or "smtp".`,
    );
  }

  console.log(
    `[coach-invite] invite for ${input.toEmail}: code ${input.code}, link ${input.accessUrl} (EMAIL_PROVIDER=console)`,
  );
}
