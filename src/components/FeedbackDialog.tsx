"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  FEEDBACK_MAX_MESSAGE_LENGTH,
  validateFeedbackFields,
  type FeedbackApiResponse,
  type FeedbackFieldErrors,
  type FeedbackSubmission,
} from "@/lib/feedback";

type Phase = "idle" | "submitting" | "success" | "error";

const fieldClass =
  "mt-2 w-full rounded-xl border border-white/15 bg-[#080d1b] px-4 py-3 text-base text-white caret-[#ffd23f] outline-none placeholder:text-white/50 focus-visible:border-[#ffd23f] focus-visible:ring-2 focus-visible:ring-[#ffd23f]/35 disabled:cursor-not-allowed disabled:opacity-60";

/**
 * crypto.randomUUID is only exposed in secure contexts, and LAN-party players
 * join over plain http://192.168.x.x. Fall back to a getRandomValues-based
 * v4 UUID so feedback never throws on those origins.
 */
function newFeedbackId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function MessageIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 18.5 3.5 21v-5A8.5 8.5 0 1 1 7 18.5Z" />
      <path d="M8 10h8M8 14h5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-7 w-7 fill-none stroke-current" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 12.5 4.25 4.25L19 7" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

export default function FeedbackDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const submissionRef = useRef<FeedbackSubmission | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [message, setMessage] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [fieldErrors, setFieldErrors] = useState<FeedbackFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const openDialog = () => {
    setPhase("idle");
    setFieldErrors({});
    setFormError(null);
    dialogRef.current?.showModal();
    window.setTimeout(() => messageRef.current?.focus(), 0);
  };

  const closeDialog = () => {
    abortRef.current?.abort();
    dialogRef.current?.close();
  };

  useEffect(() => {
    if (phase === "success") resultHeadingRef.current?.focus();
  }, [phase]);

  const sendSubmission = async (submission: FeedbackSubmission, website: string) => {
    const controller = new AbortController();
    abortRef.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 12_000);

    setPhase("submitting");
    setFormError(null);

    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedbackId: submission.id,
          message: submission.message,
          website,
        }),
        signal: controller.signal,
      });
      const result = (await response.json().catch(() => null)) as FeedbackApiResponse | null;
      if (controller.signal.aborted) return;

      if (!response.ok || !result?.ok) {
        if (result && !result.ok && result.field) {
          const field: keyof FeedbackFieldErrors = result.field;
          setFieldErrors((current) => ({ ...current, [field]: result.message }));
          messageRef.current?.focus();
          // The inline field error already tells the story; don't duplicate it
          // in the generic form alert.
          setPhase("idle");
          return;
        }
        throw new Error(result && !result.ok ? result.message : "We could not send your feedback. Please try again.");
      }

      setMessage("");
      submissionRef.current = null;
      setPhase("success");
    } catch (error) {
      if (controller.signal.aborted && !timedOut) return;
      setFormError(
        timedOut
          ? "The connection took too long. Your note is still here—please try once more."
          : error instanceof Error
            ? error.message
            : "We could not send your feedback. Please try again."
      );
      setPhase("error");
    } finally {
      window.clearTimeout(timeout);
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const website = String(new FormData(event.currentTarget).get("website") ?? "");
    const errors = validateFeedbackFields(message);
    setFieldErrors(errors);
    setFormError(null);

    if (errors.message) {
      setPhase("error");
      messageRef.current?.focus();
      return;
    }

    const normalizedMessage = message.trim();
    let submission = submissionRef.current;
    if (!submission || submission.message !== normalizedMessage) {
      submission = {
        id: newFeedbackId(),
        message: normalizedMessage,
      };
      submissionRef.current = submission;
    }

    await sendSubmission(submission, website);
  };

  const isSubmitting = phase === "submitting";
  const isComplete = phase === "success";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openDialog}
        className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white/90 transition hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffd23f] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1020]"
        aria-haspopup="dialog"
      >
        <MessageIcon />
        Send feedback
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="feedback-title"
        aria-describedby="feedback-description"
        onCancel={(event) => {
          event.preventDefault();
          closeDialog();
        }}
        onClose={() => triggerRef.current?.focus()}
        className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[min(92vw,34rem)] overflow-y-auto rounded-2xl border border-white/15 bg-[#151d36] p-0 text-left text-white backdrop:bg-[#050817]/80 backdrop:backdrop-blur-sm"
      >
        <div className="p-5 sm:p-7">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#ffd23f] text-[#111827]">
              <MessageIcon />
            </div>
            <div className="min-w-0 flex-1">
              <h2 id="feedback-title" className="text-balance text-2xl font-black tracking-[-0.025em] text-white">
                Help us tune the chaos
              </h2>
              <p id="feedback-description" className="mt-2 max-w-[48ch] text-sm leading-6 text-white/70">
                Tell us what clicked, what wobbled, or what would make the next run better.
              </p>
            </div>
            <button
              type="button"
              onClick={closeDialog}
              className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/65 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffd23f]"
              aria-label="Close feedback form"
            >
              <CloseIcon />
            </button>
          </div>

          {isComplete ? (
            <div className="py-8 text-center" role="status" aria-live="polite">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#6ef29a] text-[#07140b]">
                <CheckIcon />
              </div>
              <h3 ref={resultHeadingRef} tabIndex={-1} className="mt-5 text-2xl font-black tracking-[-0.025em] outline-none">
                Feedback safely landed
              </h3>
              <p className="mx-auto mt-3 max-w-[42ch] text-base leading-7 text-white/70">
                You’re officially part of the tuning crew. Thanks for helping improve Singularity.
              </p>
              <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={closeDialog}
                  className="min-h-11 rounded-xl bg-[#ffd23f] px-6 py-3 font-black text-[#181304] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#151d36]"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <form className="mt-7" onSubmit={handleSubmit} noValidate aria-busy={isSubmitting}>
              <div>
                <div className="flex items-end justify-between gap-4">
                  <label htmlFor="feedback-message" className="text-sm font-bold text-white">
                    Your feedback
                  </label>
                  <span className="text-xs tabular-nums text-white/65">
                    {message.length.toLocaleString()} / {FEEDBACK_MAX_MESSAGE_LENGTH.toLocaleString()}
                  </span>
                </div>
                <textarea
                  ref={messageRef}
                  id="feedback-message"
                  name="message"
                  required
                  rows={6}
                  maxLength={FEEDBACK_MAX_MESSAGE_LENGTH}
                  value={message}
                  onChange={(event) => {
                    setMessage(event.target.value);
                    if (fieldErrors.message) setFieldErrors((current) => ({ ...current, message: undefined }));
                  }}
                  placeholder="The ferry challenge was great, but…"
                  className={`${fieldClass} min-h-32 resize-y leading-6`}
                  disabled={isSubmitting}
                  aria-invalid={Boolean(fieldErrors.message)}
                  aria-describedby={fieldErrors.message ? "feedback-message-error" : undefined}
                />
                {fieldErrors.message && (
                  <p id="feedback-message-error" className="mt-2 text-sm font-semibold text-[#ff9b9b]">
                    {fieldErrors.message}
                  </p>
                )}
              </div>

              <div className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
                <label htmlFor="feedback-website">Website</label>
                <input id="feedback-website" name="website" tabIndex={-1} autoComplete="off" />
              </div>

              {formError && (
                <p className="mt-5 rounded-xl bg-[#491f2a] px-4 py-3 text-sm font-semibold leading-6 text-[#ffd8de]" role="alert">
                  {formError}
                </p>
              )}

              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeDialog}
                  disabled={isSubmitting}
                  className="min-h-11 rounded-xl px-5 py-3 font-bold text-white/75 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#ffd23f] px-6 py-3 font-black text-[#181304] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#151d36] disabled:cursor-wait disabled:opacity-65"
                >
                  {isSubmitting && <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#181304]/30 border-t-[#181304] motion-reduce:animate-none" aria-hidden="true" />}
                  {isSubmitting ? "Sending…" : "Send feedback"}
                </button>
              </div>
            </form>
          )}
        </div>
      </dialog>
    </>
  );
}
