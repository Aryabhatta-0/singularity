import "server-only";

import {
  buildSpacetimeFeedbackUrl,
  readResendConfig,
  type FeedbackSubmission,
} from "@/lib/feedback";
import {
  FeedbackStorageError,
  persistFeedbackRequest,
  sendFeedbackThankYouRequest,
} from "@/lib/feedback-transports";

export { FeedbackStorageError };

export async function persistFeedback(submission: FeedbackSubmission): Promise<void> {
  let endpoint: string;
  try {
    endpoint = buildSpacetimeFeedbackUrl(process.env);
  } catch {
    throw new FeedbackStorageError("SpacetimeDB is not configured correctly.");
  }

  await persistFeedbackRequest(submission, endpoint);
}

export type ThankYouResult =
  | { status: "accepted"; emailId: string }
  | { status: "failed"; reason: "configuration" | "provider" | "transport" };

export async function sendFeedbackThankYou(submission: FeedbackSubmission): Promise<ThankYouResult> {
  const config = readResendConfig(process.env);
  if (!config) return { status: "failed", reason: "configuration" };

  return sendFeedbackThankYouRequest(submission, config);
}
