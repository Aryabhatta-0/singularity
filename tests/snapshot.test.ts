import assert from "node:assert/strict";
import test from "node:test";
import {
  CHALLENGE,
  RULESET,
  createBody,
  decodeSnapshot,
  encodeSnapshot,
} from "../shared/physics.ts";

test("body snapshots round-trip through the versioned codec", () => {
  const body = createBody(CHALLENGE.Difficult, 5);
  body.ticks = 42;
  body.nodes[0].x = 0.25;
  body.hazardContacts[0] = true;
  const encoded = encodeSnapshot(body);
  const decoded = decodeSnapshot(encoded, { version: RULESET, challenge: CHALLENGE.Difficult, crewSize: 5 });
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.deepEqual(decoded.body, body);
  assert.notEqual(decoded.body, body);
});

test("snapshot decoding rejects malformed and mismatched network state", () => {
  assert.deepEqual(decodeSnapshot("not json"), { ok: false, error: "Snapshot is not valid JSON." });
  const easy = encodeSnapshot(createBody(CHALLENGE.Easy, 3));
  assert.equal(decodeSnapshot(easy, { challenge: CHALLENGE.Medium }).ok, false);
  assert.equal(decodeSnapshot(easy, { crewSize: 5 }).ok, false);
  assert.equal(decodeSnapshot(easy, { version: RULESET + 1 }).ok, false);
});

test("snapshot validation owns structural, numeric, and completion invariants", () => {
  const mutations: Array<(body: ReturnType<typeof createBody>) => void> = [
    body => { body.version = RULESET + 1; },
    body => { body.nodes.pop(); },
    body => { body.nodes[0].x = Number.NaN; },
    body => { body.objects.pop(); },
    body => { body.handGrip[0] = body.objects.length; },
    body => { body.feet[0] = 2; },
    body => { body.previousActions.pop(); },
    body => { body.hazardContacts.pop(); },
    body => { body.stage = 99; },
    body => { body.ticks = -1; },
    body => { body.charge = 1.1; },
    body => { body.finished = true; },
  ];
  for (const mutate of mutations) {
    const body = createBody(CHALLENGE.Medium, 5);
    mutate(body);
    assert.throws(() => encodeSnapshot(body), /Cannot encode invalid snapshot/);
  }

  const withNullNode = JSON.parse(encodeSnapshot(createBody())) as Record<string, unknown>;
  ((withNullNode.nodes as Array<Record<string, unknown>>)[0]).x = null;
  assert.equal(decodeSnapshot(JSON.stringify(withNullNode)).ok, false);
});
