# Repository architecture

The runtime is exclusively Three.js, TypeScript and SpacetimeDB. See `../README.md` for play, local testing and release commands.

`shared/physics.ts` is the shared deterministic contract. Six physical nodes represent torso, head, both hands and both feet. Three-player input expands Arms to both hands and Legs to both feet; five-player input maps Left Hand, Right Hand, Torso, Left Leg and Right Leg independently. The head follows the constrained body rather than consuming a player role.

The Easy, Medium and Difficult definitions each own their ordered objectives, gates, checkpoints, penalties and environment metadata. The simulation implements dual-hand objects, bend/brace posture, foot switches, moving and narrow support surfaces, climbing height, two precise Difficult placements and its synchronized launch window. Three.js builds a distinct course group for every definition and animates hazards from the same deterministic phase functions.

The first pilot fixes a room's challenge and crew size. Ranked rooms require every role for that size on each active team. The server freezes room configuration, team and role at countdown. Leave and disconnect mark an active pilot offline while retaining the assignment; rejoin is allowed only for the same identity and assignment. Online host ownership migrates. Empty rooms delete their teams and leases, while ranked results persist.

Clients submit only bounded x/z/action input. Input is rate limited, expires after 500 ms, and is ignored outside a race. Rematches reset bodies and input state. Ruleset 4 prevents old numeric assignments or body JSON from being reinterpreted. Room, team and result rows all carry challenge and crew size; leaderboard views compare only matching rules.

Practice uses exactly one human input slot and independently generated teammates for every other role. A neutral human role cannot be silently replaced by AI. Practice uses deterministic simulation timing and never writes a ranked result.

Tests cover all six challenge/crew combinations, role necessity, paired and independent limb mapping, input isolation, dual-hand carrying, exact penalties and milliseconds, deterministic completion, finite constrained physics, room configuration locks, categorized results, reconnects, rematches, responsive controls and challenge-specific browser state.

Local runs target the `singularity` database on a standalone SpacetimeDB (`spacetime start`, 127.0.0.1:3000).
