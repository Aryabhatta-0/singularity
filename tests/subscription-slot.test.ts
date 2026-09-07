import assert from "node:assert/strict";
import test from "node:test";
import { SubscriptionSlot } from "../src/subscription-slot.ts";

class FakeHandle {
  active = false;
  unsubscribeCount = 0;
  private end?: () => void;
  private readonly applyCallback: () => void;
  readonly reject: (error: unknown) => void;

  constructor(
    applyCallback: () => void,
    reject: (error: unknown) => void,
  ) {
    this.applyCallback = applyCallback;
    this.reject = reject;
  }

  apply() {
    this.active = true;
    this.applyCallback();
  }

  isActive() {
    return this.active;
  }

  unsubscribeThen(onEnd: () => void) {
    this.unsubscribeCount++;
    this.end = onEnd;
  }

  finishUnsubscribe() {
    this.active = false;
    this.end?.();
    this.end = undefined;
  }
}

function harness() {
  const opened: Array<{ key: string; handle: FakeHandle }> = [];
  const applied: string[] = [];
  const failed: unknown[] = [];
  const slot = new SubscriptionSlot<string, FakeHandle>(
    key => key,
    (key, onApplied, onError) => {
      const handle = new FakeHandle(onApplied, onError);
      opened.push({ key, handle });
      return handle;
    },
    key => applied.push(key),
    error => failed.push(error),
  );
  return { slot, opened, applied, failed };
}

test("subscription slots ignore duplicate desired scopes", () => {
  const { slot, opened, applied } = harness();
  slot.set("A");
  slot.set("A");
  assert.equal(opened.length, 1);
  opened[0].handle.apply();
  slot.set("A");
  assert.deepEqual(applied, ["A"]);
  assert.equal(opened[0].handle.unsubscribeCount, 0);
});

test("pending scope changes serialize and skip superseded scopes", () => {
  const { slot, opened, applied } = harness();
  slot.set("A");
  slot.set("B");
  slot.set("C");
  assert.deepEqual(opened.map(record => record.key), ["A"]);
  opened[0].handle.apply();
  assert.deepEqual(applied, []);
  assert.equal(opened[0].handle.unsubscribeCount, 1);
  opened[0].handle.finishUnsubscribe();
  assert.deepEqual(opened.map(record => record.key), ["A", "C"]);
  opened[1].handle.apply();
  assert.deepEqual(applied, ["C"]);
});

test("active scope changes unsubscribe exactly once before opening the latest scope", () => {
  const { slot, opened, applied } = harness();
  slot.set("A");
  opened[0].handle.apply();
  slot.set("B");
  slot.set("C");
  assert.equal(opened[0].handle.unsubscribeCount, 1);
  assert.equal(opened.length, 1);
  opened[0].handle.finishUnsubscribe();
  assert.deepEqual(opened.map(record => record.key), ["A", "C"]);
  assert.deepEqual(applied, ["A"]);
});

test("cleared, failed and disposed slots do not reopen stale scopes", () => {
  const { slot, opened, applied, failed } = harness();
  slot.set("A");
  slot.set();
  opened[0].handle.apply();
  assert.deepEqual(applied, []);
  opened[0].handle.finishUnsubscribe();
  assert.equal(opened.length, 1);

  slot.set("B");
  opened[1].handle.reject("offline");
  assert.deepEqual(failed, ["offline"]);
  slot.set("B");
  assert.equal(opened.length, 3);
  slot.dispose();
  opened[2].handle.apply();
  assert.deepEqual(applied, []);
});
