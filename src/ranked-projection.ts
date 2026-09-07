import type { RankedPhase, RankedProjection } from "./race-session.ts";

type ComparableIdentity<TIdentity> = { isEqual(other: TIdentity): boolean };
type PlayerRow<TIdentity> = {
  id: ComparableIdentity<TIdentity>;
  room: string;
  team: number;
  role: number;
  name: string;
  online: boolean;
};
type RoomRow<TIdentity> = {
  host: ComparableIdentity<TIdentity>;
  state: string;
  startAt: bigint;
  ruleset: number;
  challenge: number;
  crewSize: number;
};
type TeamRow = { room: string; number: number; body: string; finishMs: number };

export type RankedProjectionSource<TIdentity> = {
  identity?: TIdentity;
  db: {
    player: { iter(): Iterable<PlayerRow<TIdentity>> };
    room: { id: { find(code: string): RoomRow<TIdentity> | null | undefined } };
    team: { iter(): Iterable<TeamRow> };
  };
};

const rankedPhases: readonly RankedPhase[] = ["lobby", "countdown", "racing", "finished"];

export function readRankedProjection<TIdentity>(source: RankedProjectionSource<TIdentity>, requestedRoomCode?: string): RankedProjection | undefined {
  const identity = source.identity;
  if (!identity) return undefined;
  const players = [...source.db.player.iter()];
  const assignment = players.find(player => player.id.isEqual(identity));
  if (!assignment) return undefined;
  const code = (requestedRoomCode || assignment.room).trim().toUpperCase();
  if (assignment.room !== code) return undefined;
  const room = source.db.room.id.find(code);
  if (!room || !rankedPhases.includes(room.state as RankedPhase)) return undefined;
  const members = players
    .filter(player => player.room === code)
    .map(player => ({ name: player.name, team: player.team, role: player.role, online: player.online }));
  const occupiedTeams = new Set(members.map(member => member.team));
  const teams = [...source.db.team.iter()]
    .filter(team => team.room === code && occupiedTeams.has(team.number))
    .map(team => ({ number: team.number, finishMs: team.finishMs, snapshot: team.body }));
  return {
    connected: true,
    room: {
      code,
      phase: room.state as RankedPhase,
      startAtMs: Number(room.startAt / 1000n),
      ruleset: room.ruleset,
      challenge: room.challenge,
      crewSize: room.crewSize,
      isHost: room.host.isEqual(identity),
    },
    assignment: { team: assignment.team, role: assignment.role, online: assignment.online },
    members,
    teams,
  };
}
