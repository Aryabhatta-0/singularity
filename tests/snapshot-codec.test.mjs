import assert from "node:assert/strict";
import test from "node:test";
import { decodeSnapshotRow, SnapshotOrderGate } from "../src/game/snapshot-codec.ts";

const validRow = () => ({
  recvMicros: 12_000_000n,
  p: Array.from({ length: 77 }, (_, i) => (i % 7 === 6 ? 1 : 0)),
  props: [0, 1, 2, 3, 0, 0, 0, 1],
  yaw: 0,
  pitch: 0.2,
  timer: 12,
  fallen: false,
  score: 1,
  ev: JSON.stringify([{ type: "checkpoint", pos: [1, 2, 3] }]),
  msg: "good|Nice",
});

test("snapshot decoder accepts a bounded finite gameplay snapshot", () => {
  const snap = decodeSnapshotRow(validRow());
  assert.ok(snap);
  assert.equal(snap.t, 12_000);
  assert.deepEqual(snap.ev, [{ type: "checkpoint", pos: [1, 2, 3] }]);
});

test("snapshot decoder extracts bounded host-promotion state without replaying it as an effect", () => {
  const snap = decodeSnapshotRow({
    ...validRow(),
    ev: JSON.stringify([
      { type: "state", checkpoint: 2, delivered: true, moverTime: 4.5, running: true, finished: false, frozen: false, holds: [{ hand: 0, propId: -42 }, { hand: 1, propId: 3 }] },
      { type: "checkpoint", pos: [1, 2, 3] },
    ]),
  });

  assert.deepEqual(snap?.state, { checkpoint: 2, delivered: true, moverTime: 4.5, running: true, finished: false, frozen: false, holds: [{ hand: 0, propId: -42 }, { hand: 1, propId: 3 }] });
  assert.deepEqual(snap?.ev, [{ type: "checkpoint", pos: [1, 2, 3] }]);
});

test("snapshot decoder preserves bounded momentum and drops malformed promotion state", () => {
  const state = {
    type: "state", checkpoint: 0, delivered: false, moverTime: 1, running: true, finished: false, frozen: false,
    bodyVelocities: Array.from({ length: 66 }, (_, index) => index === 0 ? 12.5 : 0),
    propVelocities: [0, 1, 2, 3, 4, 5, 6],
  };
  const snap = decodeSnapshotRow({ ...validRow(), ev: JSON.stringify([state]) });
  assert.equal(snap?.state?.bodyVelocities?.length, 66);
  assert.equal(snap?.state?.bodyVelocities?.[0], 12.5);
  assert.deepEqual(snap?.state?.propVelocities, [0, 1, 2, 3, 4, 5, 6]);

  assert.equal(decodeSnapshotRow({ ...validRow(), ev: JSON.stringify([{ ...state, bodyVelocities: [1, 2] }]) })?.state, undefined);
  assert.equal(decodeSnapshotRow({ ...validRow(), ev: JSON.stringify([{ ...state, propVelocities: [0, 101, 0, 0, 0, 0, 0] }]) })?.state, undefined);
});

test("snapshot decoder rejects malformed transform arrays before rendering", () => {
  assert.equal(decodeSnapshotRow({ ...validRow(), p: [0, 1, 2] }), null);
  assert.equal(decodeSnapshotRow({ ...validRow(), p: validRow().p.with(5, Number.NaN) }), null);
  assert.equal(decodeSnapshotRow({ ...validRow(), p: validRow().p.with(0, 513) }), null);
  assert.equal(decodeSnapshotRow({ ...validRow(), p: validRow().p.with(3, 2) }), null);
  assert.equal(decodeSnapshotRow({ ...validRow(), props: [0, 1, 2] }), null);
  assert.equal(decodeSnapshotRow({ ...validRow(), props: Array(8 * 65).fill(0) }), null);
  assert.equal(decodeSnapshotRow({ ...validRow(), props: [...validRow().props, ...validRow().props] }), null);
});

test("snapshot decoder drops unsafe events and rejects non-finite gameplay scalars", () => {
  const snap = decodeSnapshotRow({
    ...validRow(),
    ev: JSON.stringify([
      { type: "checkpoint", pos: [1, 2, 3] },
      { type: "checkpoint", pos: [1, "oops", 3] },
      { type: "unknown", pos: [1, 2, 3] },
      null,
    ]),
  });
  assert.deepEqual(snap?.ev, [{ type: "checkpoint", pos: [1, 2, 3] }]);
  assert.equal(decodeSnapshotRow({ ...validRow(), timer: Number.POSITIVE_INFINITY }), null);
});

test("snapshot ordering can reset one team at a round boundary", () => {
  const gate = new SnapshotOrderGate();
  assert.equal(gate.accept(7, 2, 10n, 2), true);
  assert.equal(gate.accept(7, 2, 9n, 2), false);
  gate.clearTeam(7);
  assert.equal(gate.accept(7, 3, 1n, 3), true);
});

test("snapshot order gate rejects stale rounds and non-increasing sequences", () => {
  const order = new SnapshotOrderGate();

  assert.equal(order.accept(7, 4, 10n, 4), true);
  assert.equal(order.accept(7, 4, 10n, 4), false);
  assert.equal(order.accept(7, 4, 9n, 4), false);
  assert.equal(order.accept(7, 3, 99n, 4), false);
  assert.equal(order.accept(7, 5, 1n, 5), true);
  assert.equal(order.accept(8, 5, 1n, 5), true);
});

test("snapshot order gate allows legacy rows without ordering metadata", () => {
  const order = new SnapshotOrderGate();
  assert.equal(order.accept(7, undefined, undefined, 4), true);
});
