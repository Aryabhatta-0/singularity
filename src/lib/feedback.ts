export const FEEDBACK_MAX_EMAIL_LENGTH = 254;
export const FEEDBACK_MAX_MESSAGE_LENGTH = 1500;

const FEEDBACK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EMAIL_LOCAL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i;
const EMAIL_DOMAIN_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export interface FeedbackSubmission {
  id: string;
  email: string;
  message: string;
}

export interface FeedbackFieldErrors {
  email?: string;
  message?: string;
}

export type FeedbackApiResponse =
  | {
      ok: true;
      feedbackId: string;
      emailStatus: "accepted" | "failed";
    }
  | {
      ok: false;
      code: string;
      message: string;
      field?: keyof FeedbackFieldErrors;
    };

export type ParseFeedbackResult =
  | { ok: true; submission: FeedbackSubmission }
  | { ok: false; code: string; message: string; field?: keyof FeedbackFieldErrors };

export function normalizeFeedbackEmail(emailValue: string): string {
  const email = emailValue.trim();
  const separator = email.lastIndexOf("@");
  if (separator < 0) return email;
  return `${email.slice(0, separator)}@${email.slice(separator + 1).toLowerCase()}`;
}

export function isValidFeedbackEmail(emailValue: string): boolean {
  const email = emailValue.trim();
  if (!email || email.length > FEEDBACK_MAX_EMAIL_LENGTH || /\s/.test(email)) return false;

  const parts = email.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (
    !local ||
    local.length > 64 ||
    !EMAIL_LOCAL_PATTERN.test(local) ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..")
  ) return false;

  const labels = domain.split(".");
  return (
    domain.length <= 253 &&
    !domain.includes("..") &&
    labels.length >= 2 &&
    labels.every((label) => EMAIL_DOMAIN_LABEL_PATTERN.test(label)) &&
    labels.at(-1)!.length >= 2
  );
}

export function validateFeedbackFields(emailValue: string, messageValue: string): FeedbackFieldErrors {
  const email = emailValue.trim();
  const message = messageValue.trim();
  const errors: FeedbackFieldErrors = {};

  if (!email) {
    errors.email = "Enter the email where we should send your thank-you.";
  } else if (!isValidFeedbackEmail(email)) {
    errors.email = "Enter a valid email address.";
  }

  if (!message) {
    errors.message = "Tell us what worked, what wobbled, or what you would change.";
  } else if (message.length > FEEDBACK_MAX_MESSAGE_LENGTH) {
    errors.message = `Keep feedback under ${FEEDBACK_MAX_MESSAGE_LENGTH.toLocaleString()} characters.`;
  }

  return errors;
}

export function parseFeedbackSubmission(value: unknown): ParseFeedbackResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, code: "INVALID_BODY", message: "Send a valid feedback form." };
  }

  const body = value as Record<string, unknown>;
  const id = typeof body.feedbackId === "string" ? body.feedbackId.trim().toLowerCase() : "";
  const email = typeof body.email === "string" ? normalizeFeedbackEmail(body.email) : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";

  if (!FEEDBACK_ID_PATTERN.test(id)) {
    return { ok: false, code: "INVALID_ID", message: "Please refresh the page and try again." };
  }

  const errors = validateFeedbackFields(email, message);
  if (errors.email) {
    return { ok: false, code: "INVALID_EMAIL", message: errors.email, field: "email" };
  }
  if (errors.message) {
    return { ok: false, code: "INVALID_MESSAGE", message: errors.message, field: "message" };
  }

  return { ok: true, submission: { id, email, message } };
}

export function isHoneypotFilled(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const website = (value as Record<string, unknown>).website;
  return typeof website === "string" && website.trim().length > 0;
}

export function readResendConfig(env: Record<string, string | undefined>):
  | { apiKey: string; from: string }
  | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || !from || /[\r\n]/.test(from)) return null;
  return { apiKey, from };
}

export function makeThankYouEmail(from: string, recipient: string) {
  return {
    from,
    to: [recipient],
    subject: "Thanks for your Singularity feedback",
    text: [
      "Feedback received. High five.",
      "",
      "Thanks for taking a minute to help improve Singularity. Your note is safely with the team, and it will help us make the next round of shared-body chaos even better.",
      "",
      "— The Singularity team",
    ].join("\n"),
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#0b1020;color:#f8fafc;font-family:Arial,sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b1020;padding:32px 16px">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#151d36;border:1px solid #334066;border-radius:24px;padding:36px">
            <tr><td style="font-size:12px;font-weight:700;letter-spacing:2px;color:#ffd23f">SINGULARITY</td></tr>
            <tr><td style="padding-top:16px;font-size:30px;line-height:1.2;font-weight:800;color:#ffffff">Feedback received. High five.</td></tr>
            <tr><td style="padding-top:18px;font-size:16px;line-height:1.65;color:#cbd5e1">Thanks for taking a minute to help improve Singularity. Your note is safely with the team, and it will help us make the next round of shared-body chaos even better.</td></tr>
            <tr><td style="padding-top:24px;font-size:14px;color:#94a3b8">— The Singularity team</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  };
}

export function buildSpacetimeFeedbackUrl(env: Record<string, string | undefined>): string {
  const configuredUri =
    env.SPACETIMEDB_HTTP_URI?.trim() ||
    env.NEXT_PUBLIC_SPACETIMEDB_URI?.trim() ||
    "http://127.0.0.1:3000";
  const database =
    env.SPACETIMEDB_MODULE?.trim() ||
    env.NEXT_PUBLIC_SPACETIMEDB_MODULE?.trim() ||
    "singularity";
  const url = new URL(configuredUri);

  if (url.protocol === "wss:") url.protocol = "https:";
  if (url.protocol === "ws:") url.protocol = "http:";
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("SpacetimeDB URI must use http(s) or ws(s).");
  }

  return `${url.origin}/v1/database/${encodeURIComponent(database)}/call/submit_feedback`;
}
