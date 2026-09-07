import assert from "node:assert/strict";
import test from "node:test";

import {
  FEEDBACK_MAX_MESSAGE_LENGTH,
  buildSpacetimeFeedbackUrl,
  isHoneypotFilled,
  parseFeedbackSubmission,
  validateFeedbackFields,
} from "../src/lib/feedback.ts";
import {
  FeedbackStorageError,
  persistFeedbackRequest,
} from "../src/lib/feedback-transports.ts";
import { readLimitedJson } from "../src/lib/limited-json.ts";
import { FixedWindowRateLimiter } from "../src/lib/fixed-window-rate-limiter.ts";

const feedbackId = "0f1d2c3b-4a59-4786-9abc-def012345678";

test("feedback payloads are normalized and keep Unicode content", () => {
  assert.deepEqual(
    parseFeedbackSubmission({
      feedbackId: feedbackId.toUpperCase(),
      message: "  Great wobble! 你好 👋  ",
    }),
    {
      ok: true,
      submission: {
        id: feedbackId,
        message: "Great wobble! 你好 👋",
      },
    },
  );
});

test("feedback validation rejects invalid ids, empty notes, and oversized notes", () => {
  assert.equal(parseFeedbackSubmission({ feedbackId: "nope", message: "Hi" }).ok, false);
  assert.match(validateFeedbackFields("").message ?? "", /Tell us/);
  assert.match(
    validateFeedbackFields("x".repeat(FEEDBACK_MAX_MESSAGE_LENGTH + 1)).message ?? "",
    /under 1,500 characters/,
  );
});

test("the honeypot only trips for a filled website field", () => {
  assert.equal(isHoneypotFilled({ website: "" }), false);
  assert.equal(isHoneypotFilled({ website: "  https://spam.invalid  " }), true);
  assert.equal(isHoneypotFilled(null), false);
});

test("SpacetimeDB feedback URL converts WebSocket origins and encodes the database", () => {
  assert.equal(
    buildSpacetimeFeedbackUrl({
      NEXT_PUBLIC_SPACETIMEDB_URI: "wss://spacetime.tinkerers.space",
      NEXT_PUBLIC_SPACETIMEDB_MODULE: "singularity feedback",
    }),
    "https://spacetime.tinkerers.space/v1/database/singularity%20feedback/call/submit_feedback",
  );
  assert.throws(
    () => buildSpacetimeFeedbackUrl({ SPACETIMEDB_HTTP_URI: "ftp://example.com" }),
    /must use http/,
  );
});

test("request JSON is parsed with a hard byte limit", async () => {
  const valid = new Request("http://localhost/api/feedback", {
    method: "POST",
    body: JSON.stringify({ ok: true }),
  });
  assert.deepEqual(await readLimitedJson(valid, 64), { ok: true, value: { ok: true } });

  const oversized = new Request("http://localhost/api/feedback", {
    method: "POST",
    body: "x".repeat(65),
  });
  assert.deepEqual(await readLimitedJson(oversized, 64), { ok: false, reason: "too_large" });

  const invalid = new Request("http://localhost/api/feedback", {
    method: "POST",
    body: "{",
  });
  assert.deepEqual(await readLimitedJson(invalid, 64), { ok: false, reason: "invalid" });
});

test("limited JSON handles stream boundaries and always cleans up rejected bodies", async () => {
  assert.deepEqual(await readLimitedJson({ body: null }, 10), { ok: false, reason: "invalid" });

  const encoded = new TextEncoder().encode('{"wave":"👋"}');
  const splitStream = new ReadableStream({
    start(controller) {
      for (const byte of encoded) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  assert.deepEqual(
    await readLimitedJson({ body: splitStream }, encoded.byteLength),
    { ok: true, value: { wave: "👋" } },
  );

  let invalidCancelled = false;
  const invalidUtf8 = new ReadableStream({
    start(controller) {
      controller.enqueue(Uint8Array.of(0xff));
    },
    cancel() {
      invalidCancelled = true;
    },
  });
  assert.deepEqual(await readLimitedJson({ body: invalidUtf8 }, 8), { ok: false, reason: "invalid" });
  assert.equal(invalidCancelled, true);

  const cancelRejects = new ReadableStream({
    start(controller) {
      controller.enqueue(Uint8Array.of(1, 2));
    },
    cancel() {
      throw new Error("cancel failed");
    },
  });
  assert.deepEqual(await readLimitedJson({ body: cancelRejects }, 1), { ok: false, reason: "too_large" });
});

test("fixed-window limiter caps requests, memory, and expires old buckets", () => {
  const limiter = new FixedWindowRateLimiter(2, 1_000, 2, 100);
  assert.equal(limiter.isRateLimited("one", 0), false);
  assert.equal(limiter.isRateLimited("one", 1), false);
  assert.equal(limiter.isRateLimited("one", 2), true);
  assert.equal(limiter.isRateLimited("two", 3), false);
  assert.equal(limiter.bucketCount, 2);
  assert.equal(limiter.isRateLimited("three", 4), true);
  assert.equal(limiter.bucketCount, 2);
  assert.equal(limiter.isRateLimited("three", 1_001), false);
  assert.equal(limiter.bucketCount, 2);
});

test("SpacetimeDB transport sends positional reducer arguments and accepts an empty 200", async () => {
  const submission = {
    id: feedbackId,
    message: "Great wobble!",
  };
  let captured;
  const fetcher = async (input, init) => {
    captured = { input, init };
    return new Response(null, { status: 200 });
  };

  await persistFeedbackRequest(submission, "https://stdb.example/call/submit_feedback", fetcher);
  assert.equal(captured.input, "https://stdb.example/call/submit_feedback");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(captured.init.body), [feedbackId, "Great wobble!"]);

  await assert.rejects(
    persistFeedbackRequest(submission, "https://stdb.example/call/submit_feedback", async () => new Response(null, { status: 530 })),
    FeedbackStorageError,
  );
  await assert.rejects(
    persistFeedbackRequest(submission, "https://stdb.example/call/submit_feedback", async () => {
      throw new Error("offline");
    }),
    FeedbackStorageError,
  );
});

test("feedback transport classifies abort-driven timeouts", async () => {
  const submission = {
    id: feedbackId,
    message: "Great wobble!",
  };
  const waitForAbort = async (_input, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  });

  await assert.rejects(
    persistFeedbackRequest(submission, "https://stdb.example/call/submit_feedback", waitForAbort, 1),
    FeedbackStorageError,
  );
});
