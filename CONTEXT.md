# Singularity domain glossary

## Challenge

A named difficulty track with its own course, ordered objectives, penalties, and completion conditions. The available challenges are Easy, Medium, and Difficult.

## Course Definition

The authoritative description of a Challenge's traversable surfaces, moving hazards, payload positions, checkpoints, and visual identity. Both simulation and presentation interpret the same Course Definition.

## Stage

One ordered cooperative objective within a Challenge. A Stage has an entry checkpoint, a gate that limits forward progress, and a completion condition.

## Crew

The three or five pilots assigned to one Shared Body. Every Crew role is exclusive and may control only its assigned actions.

## Role

One pilot's exclusive control responsibility over the Shared Body: paired limbs in a three-pilot Crew, or a single limb or torso in a five-pilot Crew.

## Shared Body

The single character jointly controlled by a Crew. Its state includes pose, held payloads, current Stage, penalties, and completion progress.

## Snapshot

A complete, versioned representation of a Shared Body at one simulation tick. A Snapshot is valid only when its values and structural invariants match the active ruleset.

## Race Session

The player-facing state of one attempt, from setup through active play to completion. A Race Session may be a Practice Run or a Ranked Race.

## Practice Run

A local Race Session in which automation supplies every Crew Role except the player's selected Role. It does not publish a ranked result.

## Ranked Race

A networked Race Session whose Crew assignments, Shared Body simulation, timing, and result are authoritative for the Room.

## Room

The lobby and competition context that fixes the Challenge and Crew size for its participating Teams.

## Team

One Crew and its Shared Body within a Room. Several Teams may attempt the same Challenge concurrently.

## Contending Team

A Team that remains in an active match because it has a connected pilot, has already finished, or is inside the brief whole-Crew reconnect grace. A wholly disconnected unfinished Team forfeits after that grace and no longer blocks the other Teams' result.

## Role Lease

The identity-bound ownership of one Role during countdown and racing. Disconnecting neutralizes that pilot's input but preserves the assignment briefly so the same identity can reconnect without allowing a replacement or Role switch.

## Match Lifecycle

The policy governing a Room from joining and Role assignment through readiness, racing, results, rematch, reconnection, and expiry.
