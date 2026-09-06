import assert from "node:assert/strict";
import test from "node:test";

import {
  FEEDBACK_MAX_MESSAGE_LENGTH,
  buildSpacetimeFeedbackUrl,
  isHoneypotFilled,
  makeThankYouEmail,
  parseFeedbackSubmission,
  readResendConfig,
  validateFeedbackFields,
} from "../src/lib/feedback.ts";
import {
  FeedbackStorageError,
  persistFeedbackRequest,
  sendFeedbackThankYouRequest,
} from "../src/lib/feedback-transports.ts";
import { readLimitedJson } from "../src/lib/limited-json.ts";
import { FixedWindowRateLimiter } from "../src/lib/fixed-window-rate-limiter.ts";

const feedbackId = "0f1d2c3b-4a59-4786-9abc-def012345678";

test("feedback payloads are normalized and keep Unicode content", () => {
  assert.deepEqual(
    parseFeedbackSubmission({
      feedbackId: feedbackId.toUpperCase(),
      email: "  Player@Example.COM ",
      message: "  Great wobble! 你好 👋  ",
    }),
    {
      ok: true,
      submission: {
        id: feedbackId,
        email: "Player@example.com",
        message: "Great wobble! 你好 👋",
      },
    },
  );
});

test("feedback validation rejects invalid ids, addresses, empty notes, and oversized notes", () => {
  assert.equal(parseFeedbackSubmission({ feedbackId: "nope", email: "a@b.com", message: "Hi" }).ok, false);
  assert.equal(validateFeedbackFields("not-an-email", "Useful note").email, "Enter a valid email address.");
  assert.equal(validateFeedbackFields("a@b..com", "Useful note").email, "Enter a valid email address.");
  assert.equal(validateFeedbackFields(".a@b.com", "Useful note").email, "Enter a valid email address.");
  assert.match(validateFeedbackFields("a@b.com", "").message ?? "", /Tell us/);
  assert.match(
    validateFeedbackFields("a@b.com", "x".repeat(FEEDBACK_MAX_MESSAGE_LENGTH + 1)).message ?? "",
    /under 1,500 characters/,
  );
});

test("the honeypot only trips for a filled website field", () => {
  assert.equal(isHoneypotFilled({ website: "" }), false);
  assert.equal(isHoneypotFilled({ website: "  https://spam.invalid  " }), true);
  assert.equal(isHoneypotFilled(null), false);
});

test("Resend configuration stays server-controlled and rejects header injection", () => {
  assert.equal(readResendConfig({ RESEND_API_KEY: "", RESEND_FROM_EMAIL: "Game <hi@example.com>" }), null);
  assert.equal(readResendConfig({ RESEND_API_KEY: "key", RESEND_FROM_EMAIL: "Game <hi@example.com>\r\nBcc: bad@example.com" }), null);
  assert.deepEqual(
    readResendConfig({ RESEND_API_KEY: " key ", RESEND_FROM_EMAIL: " Game <hi@example.com> " }),
    { apiKey: "key", from: "Game <hi@example.com>" },
  );
});

test("thank-you mail has exactly one dynamic recipient and fixed content", () => {
  const email = makeThankYouEmail("Singularity <feedback@example.com>", "player@example.com");
  assert.deepEqual(email.to, ["player@example.com"]);
  assert.equal(email.from, "Singularity <feedback@example.com>");
  assert.match(email.subject, /Singularity feedback/);
  assert.match(email.text, /Feedback received/);
  assert.match(email.html, /Feedback received/);
  assert.doesNotMatch(email.html, /player@example\.com/);
});

test("SpacetimeDB feedback URL converts WebSocket origins and encodes the database", () => {
  assert.equal(
    buildSpacetimeFeedbackUrl({
      NEXT_PUBLIC_SPACETIMEDB_URI: "wss://spacetimedb.tinkerers.space",
      NEXT_PUBLIC_SPACETIMEDB_MODULE: "singularity feedback",
    }),
    "https://spacetimedb.tinkerers.space/v1/database/singularity%20feedback/call/submit_feedback",
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
    email: "Player@example.com",
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
  assert.deepEqual(JSON.parse(captured.init.body), [feedbackId, "Player@example.com", "Great wobble!"]);

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

test("Resend transport sends one recipient with stable idempotency and classifies failures", async () => {
  const submission = {
    id: feedbackId,
    email: "Player@example.com",
    message: "Great wobble!",
  };
  let captured;
  const accepted = await sendFeedbackThankYouRequest(
    submission,
    { apiKey: "test-key", from: "Singularity <feedback@example.com>" },
    async (input, init) => {
      captured = { input, init };
      return Response.json({ id: "email_123" });
    },
  );

  assert.deepEqual(accepted, { status: "accepted", emailId: "email_123" });
  assert.equal(captured.input, "https://api.resend.com/emails");
  assert.equal(captured.init.headers.Authorization, "Bearer test-key");
  assert.equal(captured.init.headers["Idempotency-Key"], `feedback-thank-you/${feedbackId}`);
  assert.deepEqual(JSON.parse(captured.init.body).to, ["Player@example.com"]);

  assert.deepEqual(
    await sendFeedbackThankYouRequest(
      submission,
      { apiKey: "test-key", from: "feedback@example.com" },
      async () => new Response(null, { status: 403 }),
    ),
    { status: "failed", reason: "provider" },
  );
  assert.deepEqual(
    await sendFeedbackThankYouRequest(
      submission,
      { apiKey: "test-key", from: "feedback@example.com" },
      async () => {
        throw new Error("offline");
      },
    ),
    { status: "failed", reason: "transport" },
  );
  assert.deepEqual(
    await sendFeedbackThankYouRequest(
      submission,
      { apiKey: "test-key", from: "feedback@example.com" },
      async () => Response.json({ accepted: true }),
    ),
    { status: "failed", reason: "provider" },
  );
});

test("feedback transports classify abort-driven timeouts", async () => {
  const submission = {
    id: feedbackId,
    email: "Player@example.com",
    message: "Great wobble!",
  };
  const waitForAbort = async (_input, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  });

  await assert.rejects(
    persistFeedbackRequest(submission, "https://stdb.example/call/submit_feedback", waitForAbort, 1),
    FeedbackStorageError,
  );
  assert.deepEqual(
    await sendFeedbackThankYouRequest(
      submission,
      { apiKey: "test-key", from: "feedback@example.com" },
      waitForAbort,
      1,
    ),
    { status: "failed", reason: "transport" },
  );
});
