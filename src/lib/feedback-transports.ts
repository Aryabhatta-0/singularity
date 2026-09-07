import type { FeedbackSubmission } from "@/lib/feedback";

const DEFAULT_TIMEOUT_MS = 8_000;

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
      body: JSON.stringify([submission.id, submission.message]),
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
