import type { Snap } from "./game";

const BODY_TRANSFORM_VALUES = 11 * 7;
const PROP_TRANSFORM_STRIDE = 8;
const MAX_PROP_TRANSFORMS = 64;
const MAX_EVENTS = 32;
const MAX_ABS_WORLD_POSITION = 512;
const MAX_ABS_VELOCITY = 100;
const MIN_QUATERNION_NORM_SQUARED = 0.8;
const MAX_QUATERNION_NORM_SQUARED = 1.2;
const EVENT_TYPES = new Set([
  "step", "land", "grab", "release", "throw", "fall", "getup", "jump", "kick", "shout", "climb",
  "thud", "bounce", "splash", "crack", "checkpoint", "score", "finish",
]);

export interface SnapshotWireRow {
  recvMicros: bigint | number;
  p: readonly number[];
  props: readonly number[];
  yaw: number;
  pitch: number;
  timer: number;
  fallen: boolean;
  score: number;
  ev: string;
  msg?: string | null;
}

const finiteArray = (values: readonly number[]) => values.every(Number.isFinite);

function validTransform(values: readonly number[], offset: number): boolean {
  const [x, y, z, qx, qy, qz, qw] = values.slice(offset, offset + 7);
  if (![x, y, z].every((value) => Number.isFinite(value) && Math.abs(value) <= MAX_ABS_WORLD_POSITION)) return false;
  if (![qx, qy, qz, qw].every((value) => Number.isFinite(value) && value >= -1 && value <= 1)) return false;
  const normSquared = qx * qx + qy * qy + qz * qz + qw * qw;
  return normSquared >= MIN_QUATERNION_NORM_SQUARED && normSquared <= MAX_QUATERNION_NORM_SQUARED;
}

function safeBodyVelocities(value: unknown): number[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value) || value.length !== 11 * 6 || !value.every((component) => typeof component === "number" && Number.isFinite(component) && Math.abs(component) <= MAX_ABS_VELOCITY)) return undefined;
  return [...value];
}

function safePropVelocities(value: unknown): number[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value) || value.length % 7 !== 0 || value.length > MAX_PROP_TRANSFORMS * 7) return undefined;
  const ids = new Set<number>();
  for (let offset = 0; offset < value.length; offset += 7) {
    const id = value[offset];
    if (!Number.isSafeInteger(id) || id < 0 || id >= MAX_PROP_TRANSFORMS || ids.has(id)) return undefined;
    ids.add(id);
    for (let index = offset + 1; index < offset + 7; index++) {
      const component = value[index];
      if (typeof component !== "number" || !Number.isFinite(component) || Math.abs(component) > MAX_ABS_VELOCITY) return undefined;
    }
  }
  return [...value];
}

export class SnapshotOrderGate {
  private latest = new Map<number, { round: number; sequence: bigint }>();

  accept(teamId: number, round: number | undefined, sequence: bigint | undefined, expectedRound?: number): boolean {
    // Rolling upgrades can still receive old rows; validation becomes strict as
    // soon as both ordering fields are present.
    if (round == null && sequence == null) return true;
    if (!Number.isSafeInteger(round) || round! < 0 || typeof sequence !== "bigint" || sequence < 0n) return false;
    if (expectedRound != null && round !== expectedRound) return false;
    const previous = this.latest.get(teamId);
    if (previous && (round! < previous.round || (round === previous.round && sequence <= previous.sequence))) return false;
    this.latest.set(teamId, { round: round!, sequence });
    return true;
  }

  clear() {
    this.latest.clear();
  }

  clearTeam(teamId: number) {
    this.latest.delete(teamId);
  }
}

function safeEvents(json: string): { events: Snap["ev"]; state?: Snap["state"] } {
  if (json.length > 16_384) return { events: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { events: [] };
  }
  if (!Array.isArray(raw)) return { events: [] };
  const result: Snap["ev"] = [];
  let state: Snap["state"];
  for (const candidate of raw.slice(0, MAX_EVENTS)) {
    if (!candidate || typeof candidate !== "object") continue;
    const event = candidate as Record<string, unknown>;
    if (event.type === "state") {
      if (
        Number.isSafeInteger(event.checkpoint) && (event.checkpoint as number) >= -1 && (event.checkpoint as number) <= 64 &&
        typeof event.delivered === "boolean" && typeof event.moverTime === "number" && Number.isFinite(event.moverTime) && event.moverTime >= 0 && event.moverTime <= 7_200 &&
        typeof event.running === "boolean" && typeof event.finished === "boolean" && typeof event.frozen === "boolean"
      ) {
        const bodyVelocities = safeBodyVelocities(event.bodyVelocities);
        const propVelocities = safePropVelocities(event.propVelocities);
        if ((event.bodyVelocities != null && !bodyVelocities) || (event.propVelocities != null && !propVelocities)) continue;
        const holds = Array.isArray(event.holds) && event.holds.length <= 2
          ? event.holds.filter((value): value is { hand: 0 | 1; propId: number } => {
              if (!value || typeof value !== "object") return false;
              const hold = value as Record<string, unknown>;
              return (hold.hand === 0 || hold.hand === 1) && Number.isSafeInteger(hold.propId) && (hold.propId as number) >= -1_000_000 && (hold.propId as number) <= 63;
            })
          : [];
        const uniqueHolds = holds.filter((hold, index) => holds.findIndex((other) => other.hand === hold.hand) === index);
        state = {
          checkpoint: event.checkpoint as number,
          delivered: event.delivered,
          moverTime: event.moverTime,
          running: event.running,
          finished: event.finished,
          frozen: event.frozen,
          ...(uniqueHolds.length > 0 ? { holds: uniqueHolds.map((hold) => ({ ...hold })) } : {}),
          ...(bodyVelocities ? { bodyVelocities } : {}),
          ...(propVelocities ? { propVelocities } : {}),
        };
      }
      continue;
    }
    if (typeof event.type !== "string" || !EVENT_TYPES.has(event.type)) continue;
    if (!Array.isArray(event.pos) || event.pos.length !== 3 || !event.pos.every((x) => typeof x === "number" && Number.isFinite(x))) continue;
    const safe: Record<string, unknown> = { type: event.type, pos: [...event.pos] };
    if ((event.hand === 0 || event.hand === 1)) safe.hand = event.hand;
    if (typeof event.propId === "number" && Number.isSafeInteger(event.propId)) safe.propId = event.propId;
    if (typeof event.force === "number" && Number.isFinite(event.force)) safe.force = event.force;
    result.push(safe as Snap["ev"][number]);
  }
  return { events: result, state };
}

/** Decode untrusted database data before it reaches interpolation or Three.js. */
export function decodeSnapshotRow(row: SnapshotWireRow): Snap | null {
  if (!Array.isArray(row.p) || row.p.length !== BODY_TRANSFORM_VALUES || !finiteArray(row.p)) return null;
  if (!Array.isArray(row.props) || row.props.length % PROP_TRANSFORM_STRIDE !== 0 || row.props.length > MAX_PROP_TRANSFORMS * PROP_TRANSFORM_STRIDE || !finiteArray(row.props)) return null;
  for (let offset = 0; offset < row.p.length; offset += 7) {
    if (!validTransform(row.p, offset)) return null;
  }
  const propIds = new Set<number>();
  for (let i = 0; i < row.props.length; i += PROP_TRANSFORM_STRIDE) {
    const propId = row.props[i];
    if (!Number.isSafeInteger(propId) || propId < 0 || propId >= MAX_PROP_TRANSFORMS || propIds.has(propId)) return null;
    propIds.add(propId);
    if (!validTransform(row.props, i + 1)) return null;
  }
  if (![row.yaw, row.pitch, row.timer, row.score].every(Number.isFinite)) return null;
  if (row.timer < 0 || row.timer > 7_200 || !Number.isSafeInteger(row.score) || row.score < 0 || row.score > 1_000_000) return null;
  const recvMicros = typeof row.recvMicros === "bigint" ? Number(row.recvMicros) : row.recvMicros;
  if (!Number.isFinite(recvMicros) || recvMicros < 0) return null;
  const msg = typeof row.msg === "string" && row.msg.length <= 512 ? row.msg : undefined;
  const decodedEvents = safeEvents(row.ev);
  return {
    t: recvMicros / 1_000,
    p: [...row.p],
    props: [...row.props],
    yaw: row.yaw,
    pitch: row.pitch,
    timer: row.timer,
    fallen: row.fallen ? 1 : 0,
    score: row.score,
    ev: decodedEvents.events,
    msg,
    state: decodedEvents.state,
  };
}
