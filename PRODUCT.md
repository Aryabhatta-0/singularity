# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Groups of three or five friends who want a replayable cooperative physics challenge in a browser. Players coordinate one shared physical character, each owning an essential body-control role.

## Product Purpose

Singularity is a timed cooperative obstacle-course game. A crew succeeds by communicating, synchronizing movement, manipulating objects, and recovering from mistakes while trying to improve an exact completion time.

## Positioning

Several players directly pilot separate parts of one body: no one player can finish alone, and increasing difficulty comes from coordination and teamwork rather than intentionally unreliable controls.

## Operating Context

Players assemble a room, choose a crew size and challenge, claim one non-overlapping body role, then race together. Solo practice may supply the unclaimed roles with AI but remains unranked. Ranked multiplayer runs use authoritative server state and timing, include mistake penalties, and feed a shared leaderboard segmented by comparable rules.

## Capabilities and Constraints

- Three challenges form a fixed progression: the current course remains Easy; Medium is a longer carry-focused physics obstacle course; Difficult combines climbing, unstable platforms, precise item placement, and a timing-based finale.
- Three-player crews use Arms, Torso, and Legs roles.
- Five-player crews use Left Hand, Right Hand, Torso, Left Leg, and Right Leg roles. The two hand pilots must coordinate object handling.
- Each challenge has distinct mechanics and an environment that is easy to recognize from the others.
- Every ranked run records exact completion time. Three-player and five-player records are kept on separate leaderboard views; challenge difficulty also remains part of the comparable ruleset.
- Roles lock for a live race and reconnecting players resume their assigned role.
- Desktop keyboard and mobile touch controls are supported.
- The browser client uses Three.js. SpacetimeDB owns ranked room membership, inputs, simulation state, clocks, and persistent results.
- Practice runs are unranked. There is no account or voice-chat system.

## Brand Commitments

The product name is Singularity. Its established voice is playful, concise, and centered on cooperative physical chaos: several minds, one body, every role matters.

## Evidence on Hand

- Existing deterministic physics and challenge implementation: `shared/physics.ts`.
- Existing procedural Three.js environment and character rendering: `src/scene.ts` and `src/character.ts`.
- Existing lobby, role controls, timer, challenge HUD, and leaderboard interface: `src/main.ts` and `src/style.css`.
- Existing authoritative multiplayer and result persistence: `spacetimedb/src/index.ts`.
- Existing unit, browser, multiplayer, and measured performance verification: `tests/`.
- No user accounts, testimonials, commercial claims, or external art assets are present and future work must not fabricate them.

## Product Principles

1. Every role is understandable, responsive, and genuinely necessary.
2. Difficulty grows through communication, synchronization, and layered objectives—not frustrating controls.
3. A failed maneuver should create recoverable chaos and a meaningful time cost, not invalidate the run.
4. Ranked times are exact, authoritative, and compared only against the same challenge and crew size.
5. Courses are polished enough to replay for mastery while retaining emergent physical comedy.

## Accessibility & Inclusion

Critical state and role feedback must not rely on color alone. Controls must remain usable by keyboard, simultaneous touch/pointer input and assistive-technology activation; interactive targets must be comfortably sized and release safely when focus or visibility changes. Finale timing also has assertive non-color live feedback. Motion or effects must not obscure objectives, and reduced-motion preference must preserve meaningful state changes.
