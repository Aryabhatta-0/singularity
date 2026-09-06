import {
  makeThankYouEmail,
  type FeedbackSubmission,
} from "@/lib/feedback";

const DEFAULT_TIMEOUT_MS = 8_000;
const RESEND_EMAILS_URL = "https://api.resend.com/emails";

export type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class FeedbackStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedbackStorageError";
  }
}

async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Classification is based on the HTTP response, not cleanup behavior.
  }
}

export async function persistFeedbackRequest(
  submission: FeedbackSubmission,
  endpoint: string,
  fetcher: Fetcher = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([submission.id, submission.email, submission.message]),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new FeedbackStorageError("SpacetimeDB could not be reached.");
  }

  // SpacetimeDB reducer calls return an empty body on success. Discard any
  // unexpected payload so the underlying connection can be reused promptly.
  await discardResponseBody(response);
  if (!response.ok) {
    throw new FeedbackStorageError(`SpacetimeDB rejected the submission (${response.status}).`);
  }
}

export type EmailDeliveryResult =
  | { status: "accepted"; emailId: string }
  | { status: "failed"; reason: "provider" | "transport" };

async function sendResendEmailRequest(
  email: ReturnType<typeof makeThankYouEmail>,
  idempotencyKey: string,
  config: { apiKey: string; from: string },
  fetcher: Fetcher,
  timeoutMs: number,
): Promise<EmailDeliveryResult> {
  let response: Response;
  try {
    response = await fetcher(RESEND_EMAILS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(email),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { status: "failed", reason: "transport" };
  }

  if (!response.ok) {
    await discardResponseBody(response);
    return { status: "failed", reason: "provider" };
  }

  const data = (await response.json().catch(() => null)) as { id?: unknown } | null;
  if (typeof data?.id !== "string" || !data.id) return { status: "failed", reason: "provider" };
  return { status: "accepted", emailId: data.id };
}

export async function sendFeedbackThankYouRequest(
  submission: FeedbackSubmission,
  config: { apiKey: string; from: string },
  fetcher: Fetcher = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<EmailDeliveryResult> {
  return sendResendEmailRequest(
    makeThankYouEmail(config.from, submission.email),
    `feedback-thank-you/${submission.id}`,
    config,
    fetcher,
    timeoutMs,
  );
}
