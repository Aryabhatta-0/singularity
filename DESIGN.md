---
name: Singularity
description: Five players, one body — a team-vs-team physics race decided in head-to-head heats.
colors:
  blaze: "#BE2E0D"
  blaze-deep: "#8F2006"
  paper: "#FCF8EC"
  card: "#FFFFFF"
  ink: "#1A1410"
  event-green: "#1E7A3C"
  event-blue: "#1D5FC2"
  event-red: "#C22E2E"
  event-purple: "#7A3FC2"
  event-amber: "#B26A00"
  lobby-night: "#0C1122"
  lobby-panel: "#121A33"
  lobby-sun: "#EDB200"
  lobby-mint: "#2FA84F"
  lobby-sky: "#4FA8FF"
  course-wash: "#E4F0FE"
  course-ink: "#152742"
  course-blue: "#1D5FC2"
  course-turf-deep: "#1E7A3C"
  course-gold-deep: "#8A5E00"
  team-red: "#FF5D5D"
  team-blue: "#4FA8FF"
  team-yellow: "#FFD23F"
  team-green: "#6EF29A"
  team-purple: "#C58BFF"
  team-orange: "#FF9A3C"
typography:
  display:
    fontFamily: "Bebas Neue, Arial Narrow, Archivo, system-ui, sans-serif"
    fontSize: "clamp(3.4rem, 8vw, 6.2rem)"
    fontWeight: 400
    lineHeight: 0.9
    letterSpacing: "0.01em"
  body:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 500
    lineHeight: 1.6
  label:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.7rem"
    fontWeight: 700
    letterSpacing: "0.14em"
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.blaze}"
    textColor: "#FFFFFF"
    rounded: "{rounded.lg}"
    padding: "16px 20px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "16px 20px"
  button-join:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.md}"
    padding: "12px 24px"
  field:
    backgroundColor: "#FFFFFF"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
---

# Design System: Singularity

## Overview

**Creative North Star: "Daylight Heat-Sheet Over a Live Course"**

Landing is a chalk-dust programme on bone paper: chalk white cards, warm ink type, one cinder-red action color. The pre-game lobby is a daylight heat-sheet pinned beside the live 3D course — sky-wash ground sampled from the course fog, white marker cards, course-ink text — translucent so the running course glows through while strangers organize into crews. Once the heat starts, the RHS becomes a dark race rail and the HUD stays dark: dark chips hold contrast over bright sky mid-race, so the light-to-dark flip itself signals GO. Loading is a miniature starting gate in the same daylight language, bridging paper landing to live course.

Color psychology: cinder red-orange carries arousal and urgency for action (Create, Start, GO); night ink carries trust and focus for long sessions; turf green carries balance and recovery for Ready and praise; marigold carries optimism and attention for timer, places, and room codes. Brightness sets pleasure, saturation sets arousal — saturation is spent on one element at a time, never the whole screen.

The system refuses category defaults: no gradient hero, no emoji iconography, no glassmorphism stacks, no side-accent stripes, no eyebrow kickers, no hard block shadows. Emphasis comes from weight and scale — a Bebas headline at 0.9 line-height, tabular mono for every measured number, tonal press states that compress controls without costume shadows.

**Key Characteristics:**
- Chalk by day (landing), daylight heat-sheet pre-race, dark chips mid-race.
- One job per hue in the lobby: course blue = the heat, turf deep = the crew, cinder = go.
- Every number is tabular; every icon is one 1.8px stroke system; no emoji in UI.

## Colors

Paper, ink, and one cinder accent on landing; the night meet survives inside the game where the 3D course demands it.

### Primary
- **Cinder Red** (#BE2E0D): the only action color on landing — primary CTA, lane numbers, joint rings, focus-adjacent highlights. Deep variant (#8F2006) carries small text and focus rings where contrast demands it. Psychology: warm red-orange raises alertness and action readiness; used only where a decision is required.

### Secondary
- **Meet Ink** (#1A1410): body text, Join button, programme headings on paper.

### Tertiary
- **Event Hues** (#1E7A3C, #1D5FC2, #C22E2E, #7A3FC2, #B26A00): difficulty badges and lane numbers, one hue per event, always solid with white text.
- **Course Daylight** (wash #E4F0FE, ink #152742, blue #1D5FC2, turf deep #1E7A3C, gold deep #8A5E00): the pre-game lobby and loading bridge, sampled from the live level skies (fog `#cfe8ff`, bot `#e8f7ff`). Selected heat floods course blue with white text; selected squad and Ready flood turf deep with white text; Start stays cinder for landing continuity; room codes set gold deep. Psychology: blue carries focus for the where-decision, green carries safety for the who-decision, red-orange carries urgency for go.
- **Night HUD** (#0C1122 on #121A33 panels, marigold #EDB200 places, turf #2FA84F ready): kept for everything overlaying the bright course mid-race (top bar, timer, role card, status chips, race rail, results), where dark chips hold contrast over sky.
- **Team Spot Inks** (#FF5D5D, #4FA8FF, #FFD23F, #6EF29A, #C58BFF, #FF9A3C): functional identity per team; never recolored, never dropped.

### Neutral
- **Chalk Bone** (#FCF8EC): landing ground, flat (no gradient). Brightness carries pleasure; warmth lives in the cinder accent, not the surface.
- **Card Stock** (#FFFFFF): panels, event rows, joints on paper.
- **Ink 62/44** (rgb(26 20 16 / 62%) and /44%): secondary copy and captions on paper.

### Named Rules
**The One Accent Rule.** Landing gets cinder red and nothing else that shouts. Difficulty hues identify events; they never decorate buttons, headings, or backgrounds.

## Typography

**Display Font:** Bebas Neue (via next/font, with Arial Narrow fallback)
**Body Font:** Archivo (weights 500–900)
**Label/Mono Font:** JetBrains Mono (tabular numerals everywhere a time, code, or count appears)

**Character:** Condensed programme caps for shouting, a workhorse grotesk for explaining, a mono for measuring. Never Inter-as-display, never a serif lösning.

### Hierarchy
- **Display** (400, clamp(3.4rem, 8vw, 6.2rem), 0.9): the landing H1 and section titles. Two lines max, balanced.
- **Headline** (Bebas 400, 1.5rem, letterspaced 0.1–0.14em): wordmark, panel titles (EVENTS, PICK YOUR LIMB, HEAT SHEET, STEP titles).
- **Body** (500, 1.125rem/1.6): offer copy and how-to text, 65–75ch measure.
- **Label** (mono 700, 0.7rem, 0.14em tracking, uppercase): field labels, step numbers, lane captions.

### Named Rules
**The Tabular Numbers Rule.** Times, room codes, counts, and ranks are always JetBrains Mono with tabular-nums. A time set in proportional type is a defect.

## Layout

Landing centers a max-w-6xl programme sheet: hero grid (offer + entry form left, linkage diagram + event lanes right) collapsing to a single column under lg, each column min-w-0 so nothing forces horizontal scroll at 390px. Crew roles ride one linked rail (connector line behind joint medallions on md+). Lobby docks a max-w-440px call-sheet right over the live course with scroll-pb-48 so the sticky Step-4 action bar never traps scrolled content. During countdown and playing, the RHS dock is replaced by a max-w-300px race rail (heat-sheet header + place rows + thin progress rules) that collapses to a bottom strip on short landscape so rivalry survives touch play.

## Elevation & Depth

Flat-by-default on paper: 1px ink/14% borders, a 1px keyline plus one soft ambient shadow on cards (0 18px 44px -30px ink/28%). Depth is tonal, not lifted. CTA buttons carry a 1px deep border plus a soft action-tinted shadow that compresses on :active — the press impression without a block-shadow costume. In the lobby, depth comes from the live 3D behind translucent dark panels.

### Named Rules
**The Press Impression Rule.** Primary actions sit on a deep 1px border with a soft tinted shadow and physically compress when pressed. No hard offset blocks, no glow, no gradient shift.

## Shapes

Confidently rounded programme geometry: fields 12px, buttons 12–16px, panels and event rows 16–24px, joints and medallions fully round. No clipping, no masks, no side stripes — event identity lives in the lane number color and the difficulty badge.

## Components

### Buttons
- **Shape:** rounded 12–16px, black 800–900 type.
- **Primary:** cinder fill, white text, 1px deep border, soft action-tinted shadow, subtle brightness lift on hover, 2px compression on active.
- **Hover / Focus:** brightness/filter on hover; 2px cinder-deep outline offset 2px on focus-visible.
- **Secondary / Ghost:** transparent with ink/14% border; ink fill for Join.

### Chips
- **Style:** difficulty badges are solid event hues, white 10px tracked caps, fully round.
- **State:** lobby member chips flip to turf fill when ready; pressed joints flood with team color.

### Cards / Containers
- **Corner Style:** 16–24px on paper, 12–16px in lobby, loader, and race rail.
- **Background:** pure white card stock on landing; white marker cards on sky wash in the lobby; sky-wash loader card; night panels mid-race.
- **Shadow Strategy:** ambient paper shadow per Elevation; soft tinted shadows on CTAs only.
- **Border:** 1px ink/14% (paper) or course-ink/14% (lobby) or white/12% (mid-race HUD).
- **Internal Padding:** 16–20px panels, 10–12px rows.

### Inputs / Fields
- **Style:** white fill, ink/14% stroke, 12px radius, ink caret.
- **Focus:** cinder border plus soft red ring.
- **Error / Disabled:** error text #B3261E with role=alert and aria-invalid; disabled CTAs dim to 60%.

### Navigation
- Sticky chalk topbar: Bebas wordmark left, single section link right. In-game top bar is minimal (Lobby link, room code, mute) to keep the course visible. Pre-game RHS is a daylight heat-sheet dock (Squad → Challenge → Teams & Roles → Ready & Start); gameplay RHS is a dark race rail; lobby dock never persists into countdown or playing.

### Lobby Heat-Sheet (pre-game RHS only)
- Sky-wash translucent ground (`course-wash` at 94%) with a course-ink keyline; white marker cards with ambient paper-style shadows — the same material as landing, tinted toward the course sky.
- Header heat plate: Bebas ROOM + tabular gold-deep code, live dot (turf when rivals in, gold when waiting), ready/count/challenge summary in tabular course-ink.
- Squad select floods turf deep with white text; challenge select floods course blue with white text; Start stays cinder for landing continuity. One hue per decision, never mixed.
- Rivals collapse to one line (color dot + name + members/joints/ready + Join/Full); only your squad shows the joint grid flooding with team color. Member chips flip to turf tint with deep-turf text when ready.
- Sticky action bar is a white card (not a dark slab) with turf Ready and cinder/quiet Start.

### Race Rail (gameplay RHS only)
- Stays dark (`lobby-panel` ground, 1px `meet-line` border, `rounded-xl`, no blur, no shadow): mid-race it overlays bright sky, where dark chips hold contrast. The light-to-dark flip at countdown is the GO signal.
- Header reuses the lobby-step pattern (mono tag + Bebas title): HEAT + round and team count.
- Rows: tabular place (#1–#6), team color chip, truncated name, live status (time / score / %), thin progress rule in team color, fallen marker as a red dot + Down label (same red family as the Fallen status chip).
- Behavior: max-h-50dvh scroll-safe, collapses to a bottom compact strip on short landscape; never overlaps the role card or mobile action cluster.

### Loading Bridge (landing → gameplay)
- A miniature starting gate in daylight: sky-wash translucent card, ink Bebas title, tabular gold-deep room code, turf progress rule.
- Staged checklist reuses white marker rows; done rows tint turf with a check, pending rows stay muted. Joint dots are static (turf when connected, faint when pending) — the progress fill is the single motion.
- One rotating coaching tip on a course-blue tint (alternate legs / both-hands grab / Torso brace). Invalid-code and room-unavailable cards use the same daylight material.

### Signature Component
Role joint rail: five medallions (Left/Right Hand, Torso, Left/Right Leg) on a connector line, cinder-ringed on paper, flooding with team color when taken in the lobby. One joint per player — the line only holds when every joint pulls.

## Do's and Don'ts

### Do:
- **Do** keep team spot inks exactly as specified — they are functional identity, not decoration.
- **Do** set every measured value in tabular mono.
- **Do** preserve the four lobby steps in order: Squad → Challenge → Teams & Roles → Ready & Start.
- **Do** use the drawn stroke icon system (icons.tsx) for roles, events, sound, flags, and recovery; one weight everywhere.
- **Do** keep the RHS as lobby dock in lobby, race rail in countdown/playing, and full results after; never stack them.

### Don't:
- **Don't** put emoji or Unicode glyphs where the icon system belongs.
- **Don't** add side-accent stripes, gradient text, glassmorphism stacks, hard offset block shadows, eyebrow kickers, section-number labels, or same-size icon-card grids.
- **Don't** surface backend jargon on landing (engine names, connection states, code-format trivia) — errors name the problem and the recovery, nothing more.
- **Don't** invent times, teams, or claims; empty boards say they are empty.
