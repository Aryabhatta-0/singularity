export const FEEDBACK_MAX_MESSAGE_LENGTH = 1500;

const FEEDBACK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface FeedbackSubmission {
  id: string;
  message: string;
}

export interface FeedbackFieldErrors {
  message?: string;
}

export type FeedbackApiResponse =
  | {
      ok: true;
      feedbackId: string;
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

export function validateFeedbackFields(messageValue: string): FeedbackFieldErrors {
  const message = messageValue.trim();
  const errors: FeedbackFieldErrors = {};

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
  const message = typeof body.message === "string" ? body.message.trim() : "";

  if (!FEEDBACK_ID_PATTERN.test(id)) {
    return { ok: false, code: "INVALID_ID", message: "Please refresh the page and try again." };
  }

  const errors = validateFeedbackFields(message);
  if (errors.message) {
    return { ok: false, code: "INVALID_MESSAGE", message: errors.message, field: "message" };
  }

  return { ok: true, submission: { id, message } };
}

export function isHoneypotFilled(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const website = (value as Record<string, unknown>).website;
  return typeof website === "string" && website.trim().length > 0;
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
