import { log } from "../log.server";

export type OutgoingEmail = {
  from: string;
  to: string;
  replyTo?: string | undefined;
  subject: string;
  text: string;
  html: string;
};

export type SendResult =
  | { ok: true }
  // retryable: worth trying again later (network trouble, rate limits, provider outage).
  | { ok: false; retryable: boolean; error: string };

export type EmailProvider = {
  name: string;
  send(email: OutgoingEmail): Promise<SendResult>;
};

const SEND_TIMEOUT_MS = 10_000;

export function createResendProvider(apiKey: string): EmailProvider {
  return {
    name: "resend",
    async send(email) {
      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: email.from,
            to: [email.to],
            subject: email.subject,
            text: email.text,
            html: email.html,
            ...(email.replyTo ? { reply_to: email.replyTo } : {}),
          }),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
        if (response.ok) return { ok: true };
        const detail = (await response.text().catch(() => "")).slice(0, 300);
        // 4xx means the request itself is wrong (bad address, unverified domain): retrying will not help.
        // 429 and 5xx are the provider's problem and worth another go.
        const retryable = response.status === 429 || response.status >= 500;
        return { ok: false, retryable, error: `Resend ${response.status}: ${detail}` };
      } catch (error) {
        return {
          ok: false,
          retryable: true,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

// For local testing: prints the email instead of sending it.
export function createConsoleProvider(): EmailProvider {
  return {
    name: "console",
    async send(email) {
      log("info", "email (console provider)", { to: email.to, subject: email.subject });
      return { ok: true };
    },
  };
}

// Which provider is configured, read fresh each time. null means emails stay queued until a key is set.
export function getEmailProvider(env: NodeJS.ProcessEnv = process.env): EmailProvider | null {
  if (env["EMAIL_PROVIDER"] === "console") return createConsoleProvider();
  const key = env["RESEND_API_KEY"];
  return key ? createResendProvider(key) : null;
}

export const emailConfigured = () => getEmailProvider() !== null;
