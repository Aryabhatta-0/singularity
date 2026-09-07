---
name: Singularity
description: Several minds pilot one body through an orbital course of organized cooperative chaos.
colors:
  orbit-night: "#12212b"
  panel-glass: "rgba(18, 31, 41, 0.88)"
  control-slate: "#263844"
  field-surface: "#213743"
  starlight: "#eef4ee"
  telemetry-muted: "#a4b1b9"
  hairline: "rgba(206, 226, 226, 0.15)"
  signal-mint: "#aff2d6"
  easy-mint: "#91dfc5"
  medium-cyan: "#69d9ff"
  difficult-coral: "#ff9b73"
  warning-amber: "#ffcc70"
typography:
  display:
    fontFamily: "Barlow Condensed, Impact, sans-serif"
    fontSize: "clamp(62px, 5.4vw, 88px)"
    fontWeight: 800
    lineHeight: 0.93
    letterSpacing: "-1.5px"
  headline:
    fontFamily: "Barlow Condensed, sans-serif"
    fontSize: "38px"
    fontWeight: 700
  title:
    fontFamily: "Barlow Condensed, sans-serif"
    fontSize: "18px"
    fontWeight: 600
  body:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "10px"
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: "1.7px"
rounded:
  micro: "3px"
  status: "4px"
  field: "5px"
  control: "6px"
  card: "8px"
  panel: "10px"
  dialog: "15px"
  pill: "999px"
spacing:
  micro: "6px"
  tight: "10px"
  control: "12px"
  panel: "16px"
  card: "22px"
  shell: "28px"
  dock: "36px"
components:
  button-primary:
    backgroundColor: "{colors.signal-mint}"
    textColor: "#142b28"
    rounded: "{rounded.control}"
    padding: "12px 17px"
  button-primary-hover:
    backgroundColor: "#d5ffe8"
    textColor: "#142b28"
    rounded: "{rounded.control}"
    padding: "12px 17px"
  button-secondary:
    backgroundColor: "{colors.control-slate}"
    textColor: "{colors.starlight}"
    rounded: "{rounded.control}"
    padding: "12px 17px"
  button-secondary-hover:
    backgroundColor: "#354c58"
    textColor: "{colors.starlight}"
    rounded: "{rounded.control}"
    padding: "12px 17px"
  input-field:
    backgroundColor: "{colors.field-surface}"
    textColor: "#ffffff"
    rounded: "{rounded.field}"
    padding: "12px"
  navigation-action:
    backgroundColor: "transparent"
    textColor: "{colors.telemetry-muted}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
    height: "44px"
  challenge-choice:
    backgroundColor: "rgba(18, 33, 42, 0.9)"
    textColor: "{colors.starlight}"
    rounded: "{rounded.control}"
    padding: "13px 14px"
  role-card:
    backgroundColor: "rgba(26, 42, 52, 0.92)"
    textColor: "{colors.starlight}"
    rounded: "{rounded.card}"
    padding: "14px 16px"
  operating-panel:
    backgroundColor: "{colors.panel-glass}"
    textColor: "{colors.starlight}"
    rounded: "{rounded.panel}"
    padding: "16px"
---

# Design System: Singularity

## Overview

**Creative North Star: "The Cooperative Flight Deck"**

Singularity is a dark orbital stage operated by several people at once. A live physical course and its shared body remain the visual focal point; the interface sits over that world like a compact flight deck, turning setup, role ownership, exact timing, and recovery into readable instruments rather than separating play from presentation.

The system balances controlled operations with physical comedy. Translucent panels, hairline borders, disciplined labels, and tabular timing keep information dependable while the course grows from mint training facility to cyan cargo yard to coral foundry. Complexity rises as organized bands of choices, objectives, and assignments around an increasingly chaotic 3D center.

**Key Characteristics:**

- A full-viewport 3D course is the focal point, never a decorative thumbnail.
- Translucent operating panels frame the world without hiding its physical state.
- Condensed display type delivers challenge and momentum; a quiet sans serif carries instructions.
- One course signal color binds selection, progress, role ownership, and objective state.
- Density increases in orderly rails and docks while the center remains physically expressive.

## Colors

The palette begins with orbital blue-black and frosted neutrals, then assigns one bright signal family to each level of cooperative pressure.

### Primary

- **Beacon Mint** (`signal-mint`): Marks primary actions, keyboard focus, connection confidence, the wordmark orbit, and other persistent system-level signals.
- **Training Mint** (`easy-mint`): Carries Easy-course selection, current objectives, role ownership, and course lighting without replacing the global Beacon Mint.

### Secondary

- **Cargo Cyan** (`medium-cyan`): Re-themes the same challenge-state roles for the Medium cargo environment.

### Tertiary

- **Foundry Coral** (`difficult-coral`): Signals Difficult-course state and warms the foundry world without turning the shell into an error screen.
- **Caution Amber** (`warning-amber`): Flags penalties, physical relays, and role guidance that needs attention but is not a destructive error.

### Neutral

- **Orbit Night** (`orbit-night`): Anchors the app canvas and the Easy orbital atmosphere.
- **Panel Glass** (`panel-glass`): Supports overlaid HUD and course information while preserving the scene beneath.
- **Control Slate** (`control-slate`): Gives inactive controls enough mass to remain legible over moving 3D content.
- **Field Surface** (`field-surface`): Separates typed input from surrounding dialog material.
- **Starlight** (`starlight`): Carries high-priority copy and large numerals.
- **Telemetry Muted** (`telemetry-muted`): Carries descriptions, metadata, and inactive navigation.
- **Frosted Hairline** (`hairline`): Defines panel edges, control bounds, and row divisions without heavy chrome.

### Named Rules

**The Course Signal Rule.** Keep persistent trust and primary actions in Beacon Mint; let the active challenge color own selection, progress, role state, and course-specific feedback.

**The Redundant State Rule.** Pair every signal hue with text, a border, a number, or a shape change so critical state never relies on color alone.

## Typography

**Display Font:** Barlow Condensed (with Impact and sans-serif fallbacks)  
**Body Font:** DM Sans (with sans-serif fallback)  
**Label Font:** DM Sans

**Character:** The pairing sounds like a sports broadcast wired into mission control. Barlow Condensed turns short, playful stakes into vertical impact, while DM Sans keeps dense objectives and role instructions calm and readable.

### Hierarchy

- **Display** (`typography.display`): Reserved for the home thesis; its compact lines can occupy the left field without blanketing the course.
- **Headline** (`typography.headline`): Names dialogs, results, and major operating moments.
- **Title** (`typography.title`): Names challenges and local sections inside cards.
- **Body** (`typography.body`): Explains mechanics and objectives in short passages; keep instructional lines compact rather than editorially wide.
- **Label** (`typography.label`): Carries uppercase difficulty, state, role, and telemetry labels with deliberate tracking.

### Named Rules

**The Compression Carries Drama Rule.** Use condensed type for stakes, time, and named challenges; keep instructions, controls, and metadata in DM Sans.

## Layout

The scene is a fixed, full-viewport canvas with interface regions positioned above it. On setup screens, the invitation occupies a compact left column, the course checklist occupies the upper-right, and challenge choices plus role assignments form horizontal rails near the bottom. The open center belongs to the body and the next physical obstacle. During play, the invitation gives way to a left HUD and objective panel while the right checklist and bottom assignment dock preserve orientation.

Desktop shell offsets are deliberately asymmetric: the main invitation begins at 5% of the viewport, the course card sits 28px from the right, and the role dock holds 36px side gutters. The challenge rail stops before the checklist instead of passing beneath it. Cards use tight 6–10px gaps; larger 22–36px steps separate operating regions.

At 700px and below, setup becomes a scrollable vertical composition: the checklist hides, challenge cards stack, and the course remains a cropped live backdrop. Role cards reflow to three columns, then two below 430px. Play mode returns to a single viewport, stacks timer and objective status on the left, and exposes 44px-minimum directional controls plus a prominent action control on coarse pointers. Short desktop heights compress the hero and course card without removing the physical center.

## Elevation & Depth

Depth is a hybrid led by the Three.js world. Perspective, fog, occlusion, cast shadows, lit course materials, and drifting debris establish physical space; the interface stays comparatively flat through translucent navy surfaces, 12–18px backdrop blur, and frosted hairlines. The directional shadow volume follows the active body across long courses while its fixed sun direction prevents gait-induced swimming. Shadows appear when a choice is selected, a status glows, or a dialog must separate decisively from play.

### Shadow Vocabulary

- **Beacon glow** (`0 0 10px #aff2d64a`): Keeps the connection indicator alive without becoming a neon ornament.
- **Selected control** (`0 12px 30px rgba(0, 0, 0, 0.24)`): Gives an active crew setup a restrained lift.
- **Selected challenge** (`0 16px 38px rgba(0, 0, 0, 0.26)`): Separates the committed course from adjacent options.
- **Modal separation** (`0 30px 100px #0009`): Holds dialogs above both scene and operating chrome.

### Named Rules

**The Stage Owns the Depth Rule.** Let 3D lighting and perspective provide the drama; UI panels should clarify the world with translucency and borders, not compete through decorative shadows.

## Shapes

The interface uses compact instrument geometry: gently rounded controls, cards, and operating panels (`rounded.control` through `rounded.panel`) against hard-edged course architecture. Dialogs are softer (`rounded.dialog`) because they temporarily contain a separate task. Circles are reserved for orbital identity, numbered objective markers, joints, and timing rings; the fully rounded pill is reserved for a live alignment signal rather than general decoration.

Thin borders do most of the edge work. Selected cards keep their silhouette and change border, tint, and signal content instead of swelling or becoming a different component.

## Components

### Buttons

Buttons feel compact, dependable, and slightly tactile.

- **Shape:** Gently rounded rectangular controls (`rounded.control`) with the shared control padding.
- **Primary:** Beacon Mint with dark ink and a bold label; use for the single forward action in a local decision group.
- **Hover / Focus:** Hover brightens and lifts by 1px over 200ms; keyboard focus always adds a 2px Beacon Mint outline with 4px offset.
- **Secondary:** Control Slate with a Frosted Hairline border; hover moves to a lighter slate while preserving hierarchy beneath the primary action.

### Challenge Choices

Challenge choices preview rising complexity without changing component grammar.

- **Shape:** Low rectangular cards (`rounded.control`) with left-aligned difficulty, name, summary, and objective metadata.
- **Active:** The current course gains a challenge-colored border, a faint diagonal signal wash, and a restrained selection shadow.
- **State:** Difficulty and objective metadata repeat the active signal in text, so the border color is never the only selection cue.

### Role Assignment Cards

Role cards make ownership concrete and keep every pilot visible.

- **Shape:** Compact cards (`rounded.card`) arranged in an adaptive dock.
- **Content:** A line-art body-part icon, explicit role number, role name, and pilot or lock status.
- **Active / Locked:** The owned role receives the course border and a translucent course tint. Setup names it “YOU CONTROL THIS,” labels every other role “AI IN SOLO PRACTICE,” and shortens those labels to “AI CONTROLLED” once Practice begins.

### Cards / Containers

Operating panels read as instruments laid over the course.

- **Corner Style:** Standard panels use `rounded.panel`; dialog containers use `rounded.dialog`.
- **Background:** Panel Glass for HUD surfaces and a more opaque navy for modal tasks.
- **Shadow Strategy:** Flat by default; selection and modal states use the elevation vocabulary above.
- **Border:** One Frosted Hairline around containers and between repeated rows.
- **Internal Padding:** Compact objectives use `spacing.panel`; richer course cards use `spacing.card`.

### Inputs / Fields

Fields are direct, dark, and high-contrast.

- **Style:** Field Surface, white text, one Frosted Hairline, and the small field radius (`rounded.field`).
- **Focus:** The same 2px Beacon Mint outline and 4px offset used by buttons; the caret follows the active challenge signal.
- **Disabled:** Reduced opacity accompanies the locked configuration state, while adjacent copy explains why the field is unavailable.

### Navigation

The persistent header is a translucent 66px operating strip with the orbital mark and brand at left, low-emphasis text actions centered, and connection status at right. Navigation buttons keep a 44px minimum height, begin in Telemetry Muted, and lift subtly on hover. At mobile width the header becomes 60px, the connection status hides, and the remaining actions retain their touch size.

### Touch Controls

Touch controls appear only during play on coarse pointers. Four 44px-minimum directional buttons use inline stroke icons, while the wider action control takes the current challenge signal and changes its verb—such as ACT, BRACE, BEND, or SYNC—to match the owned role and objective. The controls form one named accessibility group, preserve simultaneous pointer sources, map Enter or Space to the focused control, release safely on cancellation or focus loss, and accept assistive-technology click activation without leaking into the global ACT binding.

The launch finale pairs its animated timing ring with explicit ALIGN, WAIT, RE-ARM, MISSED and LOCKED copy. An assertive atomic live region and a restrained one-shot audio cue announce only physics-eligible transitions; reduced-motion preference suppresses particles and camera trauma without removing state information.

## Do's and Don'ts

### Do:

- **Do** keep the physical body, course geometry, and immediate obstacle visible through or between operating surfaces.
- **Do** route course-specific selection, progress, and ownership through the active challenge signal while retaining Beacon Mint for persistent trust and primary action.
- **Do** pair color with explicit words, numbers, borders, and icons for every critical role or race state.
- **Do** use tabular numerals for timers, results, and leaderboard times.
- **Do** preserve keyboard focus, coarse-pointer controls, and the reduced-motion override.

### Don't:

- **Don't** turn the shell into an opaque dashboard that hides the shared physical character.
- **Don't** use condensed display type for instructions, form values, or dense objective descriptions.
- **Don't** mix mint, cyan, and coral as simultaneous decorative accents; one active course owns the challenge signal at a time.
- **Don't** soften every element into a pill; reserve circles and fully rounded forms for identity, sequence, joints, and live timing.
- **Don't** communicate difficulty, ownership, completion, or connection with color alone.
