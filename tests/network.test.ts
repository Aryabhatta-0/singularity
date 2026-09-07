import assert from "node:assert/strict";
import test from "node:test";
import { readRankedProjection, type RankedProjectionSource } from "../src/ranked-projection.ts";

type FakeIdentity = { value: string; isEqual(other: FakeIdentity): boolean };
const identity = (value: string): FakeIdentity => ({ value, isEqual: other => other.value === value });

function connection(options: { room?: string; phase?: string; includeSelf?: boolean } = {}) {
  const ownIdentity = identity("self");
  const code = options.room ?? "ORBIT";
  const players = [
    ...(options.includeSelf === false ? [] : [{ id: ownIdentity, room: code, team: 0, role: 1, name: "Self", online: true }]),
    { id: identity("crew"), room: code, team: 0, role: 0, name: "Crew", online: true },
    { id: identity("other"), room: "OTHER", team: 3, role: 0, name: "Other", online: true },
  ];
  const room = { id: code, host: ownIdentity, state: options.phase ?? "racing", startAt: 12_345_000n, ruleset: 3, challenge: 1, crewSize: 3 };
  const teams = [
    { id: `${code}:0`, room: code, number: 0, body: "own snapshot", finishMs: 0, challenge: 1, crewSize: 3 },
    { id: `${code}:2`, room: code, number: 2, body: "unoccupied snapshot", finishMs: 0, challenge: 1, crewSize: 3 },
    { id: "OTHER:3", room: "OTHER", number: 3, body: "other snapshot", finishMs: 0, challenge: 1, crewSize: 3 },
  ];
  return {
    identity: ownIdentity,
    db: {
      player: { iter: () => players.values() },
      room: { id: { find: (value: string) => value === code ? room : undefined } },
      team: { iter: () => teams.values() },
    },
  } as RankedProjectionSource<FakeIdentity>;
}

test("network adapter emits a plain, room-scoped ranked projection", () => {
  const result = readRankedProjection(connection(), "orbit");
  assert.ok(result);
  assert.equal(result.room.code, "ORBIT");
  assert.equal(result.room.startAtMs, 12_345);
  assert.equal(result.room.isHost, true);
  assert.deepEqual(result.members.map(member => member.name), ["Self", "Crew"]);
  assert.deepEqual(result.teams.map(team => team.number), [0]);
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.equal(JSON.stringify(result).includes("OTHER"), false);
});

test("network adapter refuses missing identities, cross-room requests, and unknown phases", () => {
  assert.equal(readRankedProjection(connection({ includeSelf: false })), undefined);
  assert.equal(readRankedProjection(connection(), "OTHER"), undefined);
  assert.equal(readRankedProjection(connection({ phase: "mystery" })), undefined);
});
