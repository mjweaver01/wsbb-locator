import { env } from "./env";

export interface SendCoachLoginCodeInput {
  toEmail: string;
  code: string;
}

async function sendWithResend({ toEmail, code }: SendCoachLoginCodeInput): Promise<void> {
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
      html: `<p>Your WSBB coach login code is <strong>${code}</strong>.</p><p>This code expires in ${env.coachAuthCodeTtlMinutes} minutes.</p>`,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend request failed (${response.status}): ${body}`);
  }
}

export async function sendCoachLoginCode(input: SendCoachLoginCodeInput): Promise<void> {
  const provider = env.emailProvider.toLowerCase();

  if (provider === "resend") {
    await sendWithResend(input);
    return;
  }

  if (provider !== "console") {
    throw new Error(`Unsupported EMAIL_PROVIDER "${env.emailProvider}". Use "console" or "resend".`);
  }

  console.log(
    `[coach-auth] code for ${input.toEmail}: ${input.code} (EMAIL_PROVIDER=console)`
  );
}
