import assert from "node:assert/strict";
import test from "node:test";

import {
  LinkQuality,
  SNAPSHOT_INTERPOLATION_DELAY_MS,
  SNAPSHOT_MAX_INTERPOLATION_DELAY_MS,
  SnapshotTimeline,
} from "../src/game/timing.ts";

const INTERVAL = 1_000 / 30;

/** Feed a 30 Hz stream whose delivery delay is `delay(i)` ms; returns the stamps. */
function feed(timeline, count, delay, start = 0) {
  const stamps = [];
  for (let i = 0; i < count; i++) {
    const server = 1_700_000_000_000 + (start + i) * INTERVAL;
    stamps.push(timeline.observe(server, 5_000 + (start + i) * INTERVAL + delay(i)));
  }
  return stamps;
}

test("a steady LAN stream keeps the minimum buffer", () => {
  const timeline = new SnapshotTimeline();
  feed(timeline, 60, () => 4);
  assert.equal(timeline.currentDelayMs, SNAPSHOT_INTERPOLATION_DELAY_MS);
});

test("bursty delivery is re-spaced on the server's timeline", () => {
  const timeline = new SnapshotTimeline();
  // Arrives in clumps of three (cellular-style batching).
  const stamps = feed(timeline, 30, (i) => 80 + (2 - (i % 3)) * INTERVAL);
  const gaps = stamps.slice(1).map((stamp, i) => stamp - stamps[i]);
  for (const gap of gaps.slice(3)) assert.ok(Math.abs(gap - INTERVAL) < 1, `even spacing, got ${gap}`);
});

test("measured jitter grows the buffer at once", () => {
  const timeline = new SnapshotTimeline();
  feed(timeline, 60, (i) => 60 + ((i * 37) % 7) * 25); // 0–150 ms of jitter
  const grown = timeline.currentDelayMs;
  assert.ok(grown >= 150 && grown <= SNAPSHOT_MAX_INTERPOLATION_DELAY_MS, `grew to ${grown}`);
  timeline.reset();
  assert.equal(timeline.currentDelayMs, SNAPSHOT_INTERPOLATION_DELAY_MS);
});

test("once the network settles, the buffer relaxes slowly", () => {
  const timeline = new SnapshotTimeline(30);
  feed(timeline, 30, (i) => 60 + ((i * 37) % 7) * 25);
  const high = timeline.currentDelayMs;
  feed(timeline, 30, () => 60, 30);
  timeline.renderTime(0);
  timeline.renderTime(1_000);
  const relaxed = timeline.currentDelayMs;
  assert.ok(relaxed < high && relaxed >= high - 41, `relaxed gently: ${high} -> ${relaxed}`);
});

test("stamps never go backwards when the route gets faster", () => {
  const timeline = new SnapshotTimeline();
  const all = [...feed(timeline, 10, () => 300), ...feed(timeline, 10, () => 20, 10)];
  for (let i = 1; i < all.length; i++) assert.ok(all[i] > all[i - 1]);
});

test("jitter is capped: past the ceiling, brief prediction beats more lag", () => {
  const timeline = new SnapshotTimeline();
  feed(timeline, 40, (i) => (i % 2 ? 2_000 : 0));
  assert.equal(timeline.currentDelayMs, SNAPSHOT_MAX_INTERPOLATION_DELAY_MS);
});

test("connection grades follow the smoothed round trip, jitter and silence", () => {
  const lan = new LinkQuality();
  for (let i = 0; i < 20; i++) lan.observe(12 + (i % 3), i * 100);
  assert.equal(lan.grade(), "good");

  const wan = new LinkQuality();
  for (let i = 0; i < 20; i++) wan.observe(280 + (i % 2) * 20, i * 100);
  assert.equal(wan.grade(), "fair", `rtt ${wan.rttMs}`);

  const cellular = new LinkQuality();
  for (let i = 0; i < 20; i++) cellular.observe(i % 2 ? 900 : 200, i * 100);
  assert.equal(cellular.grade(), "poor");

  assert.equal(lan.grade(3_000), "poor", "a silent server during a round is a poor link");
  lan.observe(Number.NaN);
  lan.observe(-5);
  assert.ok(lan.rttMs < 20, "nonsense samples are ignored");
});
