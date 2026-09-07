import {
  DbConnection,
  tables,
  type SubscriptionHandle,
} from "./module_bindings/index.ts";
import {
  RULESET,
  isChallenge,
  isCrewSize,
  type ChallengeId,
  type CrewSize,
} from "../shared/physics.ts";
import { SubscriptionSlot } from "./subscription-slot.ts";

export { readRankedProjection } from "./ranked-projection.ts";

const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
export const SERVER = env.VITE_SPACETIMEDB_URI || "ws://127.0.0.1:3000";
export const DATABASE = env.VITE_SPACETIMEDB_DATABASE || "singularity";

export type LeaderboardScope = Readonly<{
  challenge: ChallengeId;
  crewSize: CrewSize;
}>;

export type RoomUpdateKind = "simulation" | "structure";

export type GameNetwork = Readonly<{
  connection: DbConnection;
  setRoom(code?: string): void;
  setLeaderboard(scope?: LeaderboardScope): void;
  disconnect(): void;
}>;

type NetworkListeners = Readonly<{
  ready(network: GameNetwork): void;
  roomData(code: string, kind: RoomUpdateKind): void;
  leaderboardData(scope: LeaderboardScope): void;
  error(message: string): void;
}>;

export function normalizeRoomCode(value?: string) {
  const code = value?.trim().toUpperCase();
  return code && /^[A-Z0-9]{3,12}$/.test(code) ? code : undefined;
}

const leaderboardIdentity = (scope: LeaderboardScope) => `${RULESET}:${scope.challenge}:${scope.crewSize}`;

export function connect(listeners: NetworkListeners): GameNetwork {
  const token = sessionStorage.getItem("singularity-token-" + SERVER) || undefined;
  let connection!: DbConnection;
  let roomSlot: SubscriptionSlot<string, SubscriptionHandle> | undefined;
  let leaderboardSlot: SubscriptionSlot<LeaderboardScope, SubscriptionHandle> | undefined;
  let desiredRoom: string | undefined;
  let desiredLeaderboard: LeaderboardScope | undefined;
  let manuallyDisconnected = false;
  let queuedRoom: { code: string; kind: RoomUpdateKind } | undefined;
  let roomQueued = false;

  const notifyRoom = (kind: RoomUpdateKind) => {
    if (!desiredRoom) return;
    queuedRoom = {
      code: desiredRoom,
      kind: queuedRoom?.kind === "structure" || kind === "structure" ? "structure" : "simulation",
    };
    if (roomQueued) return;
    roomQueued = true;
    queueMicrotask(() => {
      roomQueued = false;
      const update = queuedRoom;
      queuedRoom = undefined;
      if (update && update.code === desiredRoom) listeners.roomData(update.code, update.kind);
    });
  };

  const network: GameNetwork = {
    get connection() {
      return connection;
    },
    setRoom(value) {
      desiredRoom = normalizeRoomCode(value);
      roomSlot?.set(desiredRoom);
    },
    setLeaderboard(scope) {
      desiredLeaderboard = scope && isChallenge(scope.challenge) && isCrewSize(scope.crewSize)
        ? { ...scope }
        : undefined;
      leaderboardSlot?.set(desiredLeaderboard);
    },
    disconnect() {
      manuallyDisconnected = true;
      roomSlot?.dispose();
      leaderboardSlot?.dispose();
      connection.disconnect();
    },
  };

  connection = DbConnection.builder()
    .withUri(SERVER)
    .withDatabaseName(DATABASE)
    .withToken(token)
    .onConnect((c, identity, nextToken) => {
      sessionStorage.setItem("singularity-token-" + SERVER, nextToken);

      c.db.team.onInsert((_context, row) => {
        if (row.room === desiredRoom) notifyRoom("structure");
      });
      c.db.team.onDelete((_context, row) => {
        if (row.room === desiredRoom) notifyRoom("structure");
      });
      c.db.team.onUpdate((_context, previous, next) => {
        if (previous.room === desiredRoom || next.room === desiredRoom) notifyRoom("simulation");
      });
      c.db.room.onInsert((_context, row) => {
        if (row.id === desiredRoom) notifyRoom("structure");
      });
      c.db.room.onDelete((_context, row) => {
        if (row.id === desiredRoom) notifyRoom("structure");
      });
      c.db.room.onUpdate((_context, previous, next) => {
        if (previous.id === desiredRoom || next.id === desiredRoom) notifyRoom("structure");
      });
      c.db.player.onInsert((_context, row) => {
        if (row.room === desiredRoom) notifyRoom("structure");
      });
      c.db.player.onDelete((_context, row) => {
        if (row.room === desiredRoom) notifyRoom("structure");
      });
      c.db.player.onUpdate((_context, previous, next) => {
        if (
          (previous.room === desiredRoom || next.room === desiredRoom) &&
          (previous.room !== next.room ||
            previous.team !== next.team ||
            previous.role !== next.role ||
            previous.name !== next.name ||
            previous.online !== next.online)
        ) notifyRoom("structure");
      });
      const notifyLeaderboard = () => {
        if (desiredLeaderboard) listeners.leaderboardData(desiredLeaderboard);
      };
      c.db.result.onInsert(notifyLeaderboard);
      c.db.result.onDelete(notifyLeaderboard);
      c.db.result.onUpdate(notifyLeaderboard);

      roomSlot = new SubscriptionSlot<string, SubscriptionHandle>(
        code => code,
        (code, onApplied, onError) => c.subscriptionBuilder()
          .onApplied(onApplied)
          .onError(context => onError(context.event))
          .subscribe([
            tables.room.where(row => row.id.eq(code)),
            tables.player.where(row => row.room.eq(code)),
            tables.team.where(row => row.room.eq(code)),
          ]),
        () => notifyRoom("structure"),
        error => listeners.error(`Room subscription failed: ${String(error)}`),
      );
      leaderboardSlot = new SubscriptionSlot<LeaderboardScope, SubscriptionHandle>(
        leaderboardIdentity,
        (scope, onApplied, onError) => c.subscriptionBuilder()
          .onApplied(onApplied)
          .onError(context => onError(context.event))
          .subscribe(tables.result.where(row =>
            row.ruleset.eq(RULESET)
              .and(row.challenge.eq(scope.challenge))
              .and(row.crewSize.eq(scope.crewSize)),
          )),
        scope => listeners.leaderboardData(scope),
        error => listeners.error(`Leaderboard subscription failed: ${String(error)}`),
      );
      roomSlot.set(desiredRoom);
      leaderboardSlot.set(desiredLeaderboard);

      c.subscriptionBuilder()
        .onApplied(() => listeners.ready(network))
        .onError(context => listeners.error(`Identity subscription failed: ${String(context.event)}`))
        .subscribe(tables.player.where(row => row.id.eq(identity)));
    })
    .onConnectError((_context, error) => listeners.error(error.message))
    .onDisconnect(() => {
      if (!manuallyDisconnected) listeners.error("Connection lost. Rejoin the room to reconnect.");
    })
    .build();

  return network;
}
