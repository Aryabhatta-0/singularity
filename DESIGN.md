---
name: Singularity
description: Five players, one body — a team-vs-team physics race where a shared ragdoll falls over a lot.
colors:
  lab-sky: "#BFE4FF"
  lab-sky-pale: "#E3F3FF"
  lab-turf: "#3FB55A"
  lab-dummy: "#FFD21A"
  lab-ink: "#14202E"
  lab-tape: "#FF4F2E"
  lab-paper: "#FFFFFF"
  course-blue: "#1D5FC2"
  course-turf-deep: "#1E7A3C"
  event-green: "#1E7A3C"
  event-blue: "#1D5FC2"
  event-red: "#C22E2E"
  event-purple: "#7A3FC2"
  hud-night: "#0C1122"
  hud-panel: "#121A33"
  hud-sun: "#EDB200"
  team-red: "#FF5D5D"
  team-blue: "#4FA8FF"
  team-yellow: "#FFD23F"
  team-green: "#6EF29A"
  team-purple: "#C58BFF"
  team-orange: "#FF9A3C"
typography:
  display:
    fontFamily: "Anybody (variable wdth 50–150), Archivo, system-ui, sans-serif"
    weight: 900
    note: "Width is a design control: wide for shouting labels, crushed for the big line."
  body:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "1.05–1.125rem"
    fontWeight: 500
    lineHeight: 1.55
  numbers:
    fontFamily: "Anybody / Archivo with tabular-nums; JetBrains Mono for room codes"
motion:
  ease-out: "cubic-bezier(0.23, 1, 0.32, 1)"
  ease-in-out: "cubic-bezier(0.77, 0, 0.175, 1)"
  spring-jelly: "linear() spring, ζ 0.38, ~27% overshoot (globals.css --spring-jelly)"
  press: "90ms squash in, 500–600ms spring out"
rounded:
  field: "14px"
  button: "18px"
  card: "22–28px"
---

# Design System: Singularity

## Overview

**North star: "The Crash-Test Lab."** The game is five people fighting over one floppy body, so onboarding shows exactly that: a yellow crash-test dummy dangling from five colored cords, one per player, in a test chamber of sky and turf sampled from the live course. It marches when the cords agree and face-plants when they don't. The page teaches the core rule ("sync or fall") by doing it, not by writing it.

Onboarding (landing → loading → lobby) is one material: flat sticker surfaces, one 3px ink outline, no soft shadows, no gradients except the hazard-tape stripe. The in-game HUD stays dark (night chips over bright sky). The light-to-dark flip at countdown is the GO signal.

## Colors

- **Lab sky** `#BFE4FF` / **sky pale** `#E3F3FF`: page ground and chamber interiors, sampled toward the course fog.
- **Turf** `#3FB55A`: the ground strip the dummy stands on.
- **Dummy yellow** `#FFD21A`: the dummy and the **only action color** (Team versus, Start, Return to landing). Ink text on top.
- **Ink** `#14202E`: every outline and all text. A deep course navy, not tinted black.
- **Hazard tape** `#FF4F2E`: stamps, the sticker header, the top-link underline. Never a button fill.
- **Team spot inks**: functional identity. In onboarding they color the puppeteer cords and cursors (yellow is skipped there because it vanishes against the dummy). Never recolored.
- **Course blue / turf deep**: lobby selections (course picked = blue, squad and Ready = turf). One hue per decision.

## Typography

- **Anybody** (variable width) for display. Wide (`font-stretch` 115–145%) for headings and buttons; crushed (52%) for the giant "One body." line. The headline physically squashes when the dummy lands.
- **Archivo** for body text, sentence case everywhere. No all-caps eyebrow labels, no middle-dot meta strings on onboarding surfaces.
- Numbers that count or identify (streaks, room codes) are tabular.

## Layout

- Landing: left column has the headline, lede and the clipboard form (name, Team versus, Free-for-all, room code). The right column is the test chamber canvas. On mobile they stack: headline, then chamber, then clipboard.
- Below the hazard tape: **Be the legs** (an interactive trainer), **Five courses** (stops on one dashed route; a little dummy head hops between them) and **Pick a limb** (an exploded dummy diagram with five callouts).
- The lobby keeps its RHS dock and four steps (Squad → Course → Crew → Ready). Only the material changed.

## Motion

Motion is spent where it explains or answers, per the animate skill's gates:

- **The one living thing:** the hero dummy (a custom verlet ragdoll, `src/components/onboarding/ragdoll-sim.ts`). It runs on rAF and pauses offscreen and when the tab is hidden.
- **Opening (once):** the dummy drops in, crumples (hit-stop, shake, dust), the cords snap on one by one and yank it upright, and the headline squashes on impact.
- **Answers to input:**
  - the name sticker slaps onto its chest
  - hovering a mode previews it (a rival ghost for versus; for free-for-all the cords snap and mini racers drop in)
  - a room-code tag swings from its wrist
  - launching flings the dummy and opens a yellow iris
- **Loading:** the dummy is assembled on a test stand, and its limbs spring on as real stages finish (room joined → arms, course ready → legs). There are no fake percentages.
- **Lobby:** claimed joints and ready chips jelly in, Start wiggles when everyone is ready, and copying the invite fires a confetti burst.
- **Buttons:** squash on press (90ms), jelly back (spring). Hover tilt is gated to fine pointers.
- **Reduced motion:** the dummy holds a static pose; the trainer steps resolve instantly; the iris, curtain, hops and jiggles are removed. Everything stays usable.

## Components

- **Test chamber** (`HeroStage`): a canvas with a 3px ink border, 28px radius, sky-pale inside and a turf strip. Role="img" with a description.
- **Clipboard:** the only "card" on the landing. White, ink outline, ink clip tab, and a "HELLO" name sticker in the corner that peels off onto the dummy.
- **Buttons:** `lab-btn` + `--go` (yellow), `--plain` (white), `--ink` (Join).
- **Loader card** (`lab-loader`): white card, assembly SVG, room-code tag, a status line (role="status"), and a speech-bubble tip.
- **Lobby cards:** white with a 2.5px ink outline; step headers are an ink pill + Anybody title in sentence case.

## Do's and Don'ts

**Do**
- Keep team inks exactly as specified.
- Show the body. If a surface is about controls, the dummy should be on it.
- Ship reduced-motion and fine-pointer gating with every animation.
- Keep accessible names stable ("Team versus", "Free-for-all", "Join", "Room code", "Room unavailable"); the browser tests depend on them.

**Don't**
- Add soft drop shadows, glassmorphism, gradient text or offset block shadows.
- Use hazard tape or team inks as button fills.
- Put all-caps eyebrows above headings or chain meta with middle dots on onboarding surfaces.
- Animate keyboard-repeated actions or anything people do hundreds of times.
