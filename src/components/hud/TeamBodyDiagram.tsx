"use client";

import type { CSSProperties } from "react";
import type { Role, SquadSize } from "@/game/types";

/**
 * The team's shared body in the lobby: every limb is a seat. Free limbs are
 * dashed, claimed limbs fill with the team colour and the owner's initial,
 * and your own limb pulses. Clicking a limb claims it. The seat buttons next
 * to it stay the accessible control, so the drawing is hidden from AT.
 */

const INK = "#14202E";

interface Region {
  role: Role;
  /** Paths drawn for this limb (3-player squads merge both arms / both legs). */
  shapes: { d: string; w: number }[];
  label: [number, number];
}

const ARM_L = "M66 70 L46 104 L40 136";
const ARM_R = "M114 70 L134 104 L140 136";
const LEG_L = "M80 150 L74 194 L72 228";
const LEG_R = "M100 150 L106 194 L108 228";

const REGIONS_5: Region[] = [
  { role: "lhand", shapes: [{ d: ARM_L, w: 15 }], label: [32, 118] },
  { role: "rhand", shapes: [{ d: ARM_R, w: 15 }], label: [148, 118] },
  { role: "torso", shapes: [{ d: "M90 66 L90 146", w: 46 }], label: [90, 106] },
  { role: "lleg", shapes: [{ d: LEG_L, w: 18 }], label: [58, 204] },
  { role: "rleg", shapes: [{ d: LEG_R, w: 18 }], label: [122, 204] },
];

const REGIONS_3: Region[] = [
  { role: "arms", shapes: [{ d: ARM_L, w: 15 }, { d: ARM_R, w: 15 }], label: [148, 118] },
  { role: "torso", shapes: [{ d: "M90 66 L90 146", w: 46 }], label: [90, 106] },
  { role: "legs", shapes: [{ d: LEG_L, w: 18 }, { d: LEG_R, w: 18 }], label: [122, 204] },
];

export interface Seat {
  role: Role;
  owner: { id: string; name: string; ready: boolean } | null;
}

export default function TeamBodyDiagram({
  squad,
  seats,
  myId,
  color,
  onPick,
}: {
  squad: SquadSize;
  seats: Seat[];
  myId: string;
  color: string;
  onPick: (role: Role) => void;
}) {
  const regions = squad === 3 ? REGIONS_3 : REGIONS_5;
  const seatOf = (role: Role) => seats.find((s) => s.role === role);
  const filled = seats.filter((s) => s.owner).length;
  const complete = filled === seats.length;
  return (
    <svg viewBox="0 0 180 244" className={`body-diagram ${complete ? "is-complete" : ""}`} style={{ "--team": color } as CSSProperties} aria-hidden="true">
      {/* head (rides with the torso seat) */}
      <circle cx="90" cy="36" r="24" className="body-diagram-head" />
      <circle cx="82" cy="34" r="4" fill={INK} />
      <circle cx="98" cy="34" r="4" fill={INK} />
      <path d="M82 46 Q90 52 98 46" stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" />
      {regions.map((r) => {
        const seat = seatOf(r.role);
        const owner = seat?.owner ?? null;
        const mine = owner?.id === myId;
        const state = mine ? "is-mine" : owner ? "is-taken" : "is-free";
        return (
          <g
            key={r.role}
            className={`body-limb ${state} ${owner?.ready ? "is-ready" : ""}`}
            onClick={() => onPick(r.role)}
          >
            {r.shapes.map((s) => (
              <g key={s.d}>
                <path d={s.d} strokeWidth={s.w + 7} className="body-limb-ink" />
                <path d={s.d} strokeWidth={s.w} className="body-limb-fill" />
              </g>
            ))}
            <g transform={`translate(${r.label[0]} ${r.label[1]})`} className="body-limb-tag">
              <circle r="11" />
              <text dy="4" textAnchor="middle">{owner ? owner.name.charAt(0).toUpperCase() : "+"}</text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}
