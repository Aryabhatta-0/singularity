import "server-only";

import {
  buildSpacetimeFeedbackUrl,
  type FeedbackSubmission,
} from "@/lib/feedback";
import {
  FeedbackStorageError,
  persistFeedbackRequest,
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
