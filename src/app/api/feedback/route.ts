import { NextRequest, NextResponse } from "next/server";
import {
  isHoneypotFilled,
  parseFeedbackSubmission,
  type FeedbackApiResponse,
} from "@/lib/feedback";
import { persistFeedback } from "@/lib/server/feedback-service";
import { readLimitedJson } from "@/lib/limited-json";
import { FixedWindowRateLimiter } from "@/lib/fixed-window-rate-limiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 8_192;
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1_000;
const rateLimiter = new FixedWindowRateLimiter(RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);

function respond(body: FeedbackApiResponse, status: number) {
  return NextResponse.json(body, { status });
}

function clientAddress(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

export async function POST(request: NextRequest) {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return respond(
      { ok: false, code: "CROSS_SITE", message: "Open Singularity and submit feedback there." },
      403
    );
  }

  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (mediaType !== "application/json") {
    return respond(
      { ok: false, code: "UNSUPPORTED_MEDIA_TYPE", message: "Send feedback as JSON." },
      415
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return respond(
      { ok: false, code: "PAYLOAD_TOO_LARGE", message: "That feedback is too long to submit." },
      413
    );
  }

  const parsedBody = await readLimitedJson(request, MAX_REQUEST_BYTES);
  if (!parsedBody.ok) {
    if (parsedBody.reason === "too_large") {
      return respond(
        { ok: false, code: "PAYLOAD_TOO_LARGE", message: "That feedback is too long to submit." },
        413
      );
    }
    return respond(
      { ok: false, code: "INVALID_JSON", message: "We could not read that feedback form." },
      400
    );
  }
  const body = parsedBody.value;

  // Quietly accept bot-filled honeypot submissions without storing anything.
  if (isHoneypotFilled(body)) {
    return respond({ ok: true, feedbackId: crypto.randomUUID() }, 201);
  }

  const parsed = parseFeedbackSubmission(body);
  if (!parsed.ok) {
    return respond(
      { ok: false, code: parsed.code, message: parsed.message, field: parsed.field },
      422
    );
  }

  if (rateLimiter.isRateLimited(clientAddress(request))) {
    return respond(
      { ok: false, code: "RATE_LIMITED", message: "Thanks for all the notes. Please wait a few minutes before sending another." },
      429
    );
  }

  try {
    await persistFeedback(parsed.submission);
  } catch (error) {
    console.error("Feedback persistence failed.", {
      feedbackId: parsed.submission.id,
      error: error instanceof Error ? error.name : "UnknownError",
    });
    return respond(
      { ok: false, code: "STORAGE_UNAVAILABLE", message: "We could not save your feedback just now. Please try again." },
      502
    );
  }

  return respond({ ok: true, feedbackId: parsed.submission.id }, 201);
}
