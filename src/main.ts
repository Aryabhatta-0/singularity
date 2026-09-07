import "./style.css";
import { createScene } from "./scene";
import { GameFeedbackTracker, type GameFeedbackEvent } from "./game-feedback";
import {
  CHALLENGE,
  CHALLENGES,
  CREW_SIZES,
  RULESET,
  challengeFor,
  formatTime,
  isChallenge,
  isCrewSize,
  rolesFor,
  securelyHeld,
  stageProgressValue,
  type Body,
  type ChallengeId,
  type CrewSize,
  type Input,
} from "../shared/physics";
import { finaleAnnouncement, finaleCueState, finaleRoleCopy, finaleSignalCopy } from "./finale-status";
import { createRaceSession, type RaceSessionSignal, type RaceSessionView } from "./race-session";
import {
  DATABASE,
  SERVER,
  connect,
  normalizeRoomCode,
  readRankedProjection,
  type GameNetwork,
  type LeaderboardScope,
  type RoomUpdateKind,
} from "./network";
import type { DbConnection } from "./module_bindings";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const setText = (element: HTMLElement, value: string) => {
  if (element.textContent !== value) element.textContent = value;
};
const setProgress = (element: HTMLProgressElement, value: number) => {
  if (element.value !== value) element.value = value;
};
const setData = (element: HTMLElement, key: string, value: string) => {
  if (element.dataset[key] !== value) element.dataset[key] = value;
};
const challengeButtons = (context: string) => CHALLENGES.map(challenge => `
  <button class="challenge-choice" data-${context}-challenge="${challenge.id}" aria-pressed="${challenge.id === 0}">
    <span class="difficulty">${challenge.difficulty}</span>
    <b>${challenge.name}</b>
    <small>${challenge.summary}</small>
    <i>${challenge.stages.length} objectives · +${challenge.fallPenaltyMs / 1000}s falls</i>
  </button>`).join("");
const crewButtons = (context: string) => CREW_SIZES.map(size => `
  <button data-${context}-crew="${size}" aria-pressed="${size === 5}">
    <b>${size} pilots</b><small>${size === 3 ? "Arms · Torso · Legs" : "Two hands · Torso · Two legs"}</small>
  </button>`).join("");
const arrowIcon = (direction: "left" | "up" | "down" | "right") => `
  <svg class="control-icon control-icon-${direction}" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M19 12H5m6-6-6 6 6 6" />
  </svg>`;
const closeIcon = `
  <svg class="close-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="m6 6 12 12M18 6 6 18" />
  </svg>`;

document.querySelector("#app")!.innerHTML = `
<!--
THESIS: One body becomes a three-step ladder of cooperative chaos; difficulty is visible before a crew commits.
OWN-WORLD: Preserve Singularity's dark orbital stage, mint/coral signal color, condensed labels, and physical 3D centerpiece.
STORY: Choose Easy, Medium, or Difficult; choose three or five pilots; claim one indispensable body part; beat an exact shared time.
FIRST VIEWPORT: The live body remains central, with a compact mission rail below the primary invitation and crew mode beside it.
FORM: Established game shell extended as an operating surface; local extension, no replacement seed.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
-->
<div id="world"></div><div class="vignette"></div>
<header>
  <div class="brand"><i class="brand-icon"></i>SINGULARITY<span>®</span></div>
  <nav><button id="help">How to play</button><button id="leaders">Leaderboard</button><button id="sound" aria-label="Toggle sound">Sound on</button></nav>
  <div class="status"><i class="dot"></i><span id="connection">PHYSICS. TOGETHER.</span></div>
</header>
<main class="intro">
  <h1><span id="hero-count">THREE OR FIVE</span> MINDS.<br>ONE BODY.<br><em>GOOD LUCK.</em></h1>
  <p>Pilot separate parts of one shared body. Talk constantly. Hold on when the course stops cooperating.</p>
  <div class="crew-switch" id="home-crew" aria-label="Crew size">${crewButtons("home")}</div>
  <div class="actions"><button class="primary" id="open-lobby">Assemble your crew</button><button id="practice">Practice this setup</button></div>
  <p class="tiny" id="home-summary">5 pilots · Easy · Exact server-timed records<br>Solo practice available. No download required.</p>
</main>
<section class="mission-rail" aria-label="Choose a challenge">
  <div class="rail-heading"><b>Choose the chaos</b><span>Each course adds a new coordination layer.</span></div>
  <div class="challenge-choices">${challengeButtons("home")}</div>
</section>
<section class="hud">
  <div class="section-label" id="mode-label">SOLO PRACTICE / UNRANKED</div>
  <div class="timer" id="timer">00:00.000</div>
  <div class="pill" id="race-status">READY TO WOBBLE</div>
  <div id="standings"></div>
  <button class="back" id="room-panel">Crew / rematch</button>
  <button class="back" id="exit">Leave course</button>
</section>
<aside class="course-card">
  <div class="difficulty-lockup"><span id="course-difficulty">Easy</span><i id="course-penalty">+3s per fall</i></div>
  <div class="course-title" id="course-title"></div>
  <div class="course-meta" id="course-meta"></div>
  <div id="course-stages"></div>
  <div class="course-footer"><span id="course-count"></span><strong>∞ WAYS TO FALL</strong></div>
</aside>
<div class="objective-panel" id="objective-panel">
  <div class="objective-kicker"><span id="objective-difficulty"></span><i id="sync-signal"></i></div>
  <span id="sync-announcement" class="sr-only" aria-live="assertive" aria-atomic="true"></span>
  <b id="objective-title"></b><span id="objective-hint"></span>
  <progress id="objective-progress" max="1" value="0" aria-label="Objective progress"></progress>
  <small id="role-feedback"></small>
</div>
<div class="instruction" id="instruction"></div><div class="countdown" id="countdown"></div>
<section class="role-dock">
  <div class="dock-heading"><b>CHOOSE THE PART YOU CONTROL</b><span>Solo Practice fills every other part with AI.</span></div>
  <div class="roles" id="role-cards"></div>
</section>
<div class="touch" role="group" aria-label="Touch controls">
  <button data-key="a" aria-label="Move left">${arrowIcon("left")}</button><button data-key="w" aria-label="Move forward">${arrowIcon("up")}</button>
  <button data-key="s" aria-label="Move backward">${arrowIcon("down")}</button><button data-key="d" aria-label="Move right">${arrowIcon("right")}</button>
  <button data-key=" " class="grab">ACT</button>
</div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>

<dialog id="lobby">
  <button class="close" data-close="lobby" aria-label="Close">${closeIcon}</button>
  <h2>Assemble the crew.</h2>
  <p>Every team in a room races the same challenge with the same crew size. The first pilot fixes the room setup.</p>
  <fieldset class="setup-field"><legend>CHALLENGE</legend><div class="lobby-challenges">${challengeButtons("lobby")}</div></fieldset>
  <fieldset class="setup-field"><legend>CREW SIZE</legend><div class="crew-switch lobby-crew">${crewButtons("lobby")}</div></fieldset>
  <label class="field">YOUR CALLSIGN<input id="name" maxlength="20" placeholder="Cosmic noodle" autocomplete="nickname"></label>
  <div class="form-row">
    <label class="field">ROOM CODE<input id="code" maxlength="12" placeholder="ORBIT" value="ORBIT"></label>
    <label class="field">YOUR TEAM<select id="team"><option value="0">01 / Coral crew</option><option value="1">02 / Mint condition</option><option value="2">03 / Purple haze</option><option value="3">04 / Solar flares</option></select></label>
  </div>
  <label class="field">YOUR BODY PART<select id="part"></select></label>
  <div class="room-contract" id="room-contract"></div>
  <div class="actions"><button class="primary" id="join">Join room</button><button id="start" hidden>Start race</button><button id="invite">Copy invite</button></div>
  <p class="error" id="network-error"></p><div class="members" id="members"></div>
  <p class="tiny" id="lobby-footnote">The host starts when every active team fills every role. Assignments lock at countdown; reconnecting pilots resume their original role.</p>
</dialog>

<dialog id="help-dialog">
  <button class="close" data-close="help-dialog" aria-label="Close">${closeIcon}</button>
  <h2 id="help-title"></h2>
  <div id="help-roles"></div>
  <p id="help-course"></p>
  <p>Roles lock for a live race. Falls restore the current checkpoint and add the course penalty. Ranked clocks and results come from the server; practice is always unranked.</p>
  <button class="primary" data-close="help-dialog">Ready to coordinate</button>
</dialog>

<dialog id="leader-dialog" class="leader-dialog">
  <button class="close" data-close="leader-dialog" aria-label="Close">${closeIcon}</button>
  <h2>Exact times. Comparable crews.</h2>
  <div class="leader-filters">
    <div class="tab-list" id="leader-crew-tabs" role="tablist" aria-label="Crew-size leaderboard">${CREW_SIZES.map(size => `<button role="tab" data-leader-crew="${size}" aria-selected="${size === 5}">${size}-player records</button>`).join("")}</div>
    <div class="tab-list challenge-tabs" id="leader-challenge-tabs" role="tablist" aria-label="Challenge leaderboard">${CHALLENGES.map(challenge => `<button role="tab" data-leader-challenge="${challenge.id}" aria-selected="${challenge.id === 0}">${challenge.difficulty}</button>`).join("")}</div>
  </div>
  <p id="leader-description"></p><div id="leader-list">Connecting to the shared leaderboard…</div>
</dialog>

<dialog id="finish-dialog">
  <button class="close" data-close="finish-dialog" aria-label="Close">${closeIcon}</button>
  <h2>You held it together.</h2><p class="result-status" id="finish-label">MISSION COMPLETE</p>
  <div class="big-result" id="finish-time"></div><p id="finish-detail"></p>
  <button class="primary" id="again">Run it again</button>
</dialog>`;

let scene: ReturnType<typeof createScene>;
try {
  scene = createScene($("world"));
} catch (error) {
  $("toast").textContent = "3D rendering could not start. Enable WebGL in your browser and reload.";
  throw error;
}

let leaderboardChallenge: ChallengeId = CHALLENGE.Easy;
let leaderboardCrew: CrewSize = 5;
const race = createRaceSession();
let conn: DbConnection | undefined;
let gameNetwork: GameNetwork | undefined;
let ready = false;
let allowRankedAdoption = false;
let reconnectAssignment = false;
const rememberedRoomKey = `singularity-room-${SERVER}/${DATABASE}`;
let muted = false;
let audio: AudioContext | undefined;
let audioMaster: GainNode | undefined;
let nextVoice = 0;
const audioVoices: Array<{ oscillator: OscillatorNode; gain: GainNode }> = [];
const renderBodies = new Map<number, Body>();
const keys = new Set<string>();
const controlKeys = new Set<string>();
const controlKeyboardActive = new Set<HTMLElement>();
const controlResetters = new Set<() => void>();
let toastTimer: ReturnType<typeof setTimeout>;

function clearInputs() {
  keys.clear();
  controlKeys.clear();
  controlKeyboardActive.clear();
  controlResetters.forEach(reset => reset());
}

function toast(message: string) {
  $("toast").textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("toast").textContent = ""; }, 5000);
}

function beep(
  frequency = 440,
  duration = 0.3,
  volume = 0.045,
  wave: OscillatorType = "sine",
  endRatio = 1.5,
) {
  if (muted) return;
  try {
    const context = ensureAudio();
    void context.resume();
    const voice = audioVoices[nextVoice++ % audioVoices.length];
    const now = context.currentTime;
    voice.oscillator.type = wave;
    voice.oscillator.frequency.cancelScheduledValues(now);
    voice.oscillator.frequency.setValueAtTime(frequency, now);
    voice.oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, frequency * endRatio), now + duration * 0.45);
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(0.0001, now);
    voice.gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), now + 0.006);
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  } catch {}
}

function ensureAudio() {
  if (audio) return audio;
  audio = new AudioContext();
  audioMaster = audio.createGain();
  audioMaster.gain.value = muted ? 0 : 1;
  audioMaster.connect(audio.destination);
  for (let index = 0; index < 6; index++) {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    gain.gain.value = 0.0001;
    oscillator.connect(gain).connect(audioMaster);
    oscillator.start();
    audioVoices.push({ oscillator, gain });
  }
  return audio;
}

function unlockAudio() {
  if (muted) return;
  try { void ensureAudio().resume(); } catch {}
}

window.addEventListener("pointerdown", unlockAudio, { once: true, capture: true });
window.addEventListener("keydown", unlockAudio, { once: true, capture: true });

function playGameFeedback(event: GameFeedbackEvent) {
  switch (event.kind) {
    case "align": beep(920, 0.12, 0.03, "sine", 1.12); break;
    case "step": beep(118, 0.055, 0.009 * event.strength, "triangle", 0.82); break;
    case "lift": beep(210, 0.11, 0.018, "triangle", 1.38); break;
    case "land": beep(92, 0.13, 0.025 * event.strength, "sine", 0.72); break;
    case "grip": beep(510, 0.08, 0.014, "sine", 1.2); break;
    case "impact": beep(86, 0.2, 0.042 * event.strength, "sawtooth", 0.56); break;
    case "stage": beep(650, 0.28, 0.042, "sine", 1.5); break;
    case "fall": beep(180, 0.34, 0.045, "triangle", 0.48); break;
    case "mistake": beep(130, 0.3, 0.046, "square", 0.62); break;
    case "finish": beep(820, 0.48, 0.05, "sine", 1.5); break;
  }
}

const gameFeedback = new GameFeedbackTracker(event => {
  scene.feedback(event);
  playGameFeedback(event);
});

function modal(id: string) {
  const dialog = $(id);
  if (dialog instanceof HTMLDialogElement) dialog.showModal();
  clearInputs();
}

document.querySelectorAll<HTMLElement>("[data-close]").forEach(element => {
  element.onclick = () => ($(element.dataset.close!) as HTMLDialogElement).close();
});

function roleIcon(index: number, crewSize: CrewSize) {
  const hand = crewSize === 3 ? index === 0 : index < 2;
  const torso = crewSize === 3 ? index === 1 : index === 2;
  if (hand) return `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 18v-7m4 7V7m4 11V6m4 12V9m4 9v-5c0-2 4-2 4 1v6c0 7-4 10-10 10h-2C9 30 5 26 5 20v-2c0-3 2-4 4-1l2 3"/></svg>`;
  if (torso) return `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M11 5c3 2 7 2 10 0l4 5-3 5v12H10V15l-3-5 4-5Z"/><path d="M12 17h8"/></svg>`;
  return `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M11 4h5l-1 12-4 12H5l4-13 2-11Zm10 0h-5l1 12 4 12h6l-4-13-2-11Z"/></svg>`;
}

function joinedRoom() {
  return race.view(Date.now()).mode === "ranked";
}

function selectRole(value: number) {
  const signals = race.dispatch({ type: "select-role", role: value });
  if (signals.length) { handleSignals(signals); return; }
  drawRoles();
}

function drawRoles() {
  const view = race.view(Date.now());
  const selectedCrew = view.setup.crewSize;
  const role = view.roleSelection;
  const roles = rolesFor(selectedCrew);
  const locked = view.roleLocked;
  $("role-cards").innerHTML = roles.map((definition, index) => `
    <button class="role ${index === role ? "active" : ""}" data-role="${index}" aria-pressed="${index === role}" ${locked ? "disabled" : ""} title="${locked ? "Assigned for this race" : definition.help}">
      <kbd>ROLE ${index + 1}</kbd><div class="role-icon">${roleIcon(index, selectedCrew)}</div><b>${definition.name}</b>
      <small id="pilot-${index}">${index === role ? "YOU CONTROL THIS" : "AI IN SOLO PRACTICE"}</small>
    </button>`).join("");
  document.querySelectorAll<HTMLButtonElement>("[data-role]").forEach(element => {
    element.onclick = () => selectRole(Number(element.dataset.role));
  });
  const part = $("part") as HTMLSelectElement;
  part.replaceChildren(...roles.map((definition, index) => new Option(definition.name, String(index), false, index === role)));
  part.disabled = locked;
  $("instruction").textContent = `${roles[role].name} · ${roles[role].help}`;
  updateActionLabel();
  const dockHeading = document.querySelector<HTMLElement>(".dock-heading b")!;
  const dockHelper = document.querySelector<HTMLElement>(".dock-heading span")!;
  dockHeading.textContent = view.mode === "practice" ? "SOLO PRACTICE · YOUR PART" : locked ? "CREW ASSIGNMENTS · LOCKED" : `${selectedCrew}-PART BODY · PICK YOUR PART`;
  dockHelper.textContent = view.mode === "practice" ? "AI controls every other part." : locked ? "One pilot per part. Every part matters." : "Solo Practice fills every other part with AI.";
  if (view.mode === "practice") {
    roles.forEach((_, index) => { $("pilot-" + index).textContent = index === role ? "YOU CONTROL THIS" : "AI CONTROLLED"; });
  }
}

function updateCourseUI() {
  const challenge = challengeFor(race.view(Date.now()).setup.challenge);
  $("course-difficulty").textContent = challenge.difficulty;
  $("course-penalty").textContent = `+${challenge.fallPenaltyMs / 1000}s per fall`;
  $("course-title").textContent = challenge.name;
  $("course-meta").textContent = challenge.environment;
  $("course-count").textContent = `${challenge.stages.length} OBJECTIVES`;
  $("course-stages").innerHTML = challenge.stages.map((stage, index) => `
    <div class="stage ${index === 0 ? "current" : ""}" id="stage-${index}">
      <span class="stage-num">${String(index + 1).padStart(2, "0")}</span><div><b>${stage.name}</b><small>${stage.hint}</small></div>
    </div>`).join("");
  $("objective-difficulty").textContent = challenge.difficulty.toUpperCase();
  $("help-course").textContent = `${challenge.name}: ${challenge.summary} This course has ${challenge.stages.length} ordered objectives and adds ${challenge.fallPenaltyMs / 1000} seconds per fall.`;
  document.documentElement.style.setProperty("--challenge", challenge.accent);
}

function updateHelp() {
  const selectedCrew = race.view(Date.now()).setup.crewSize;
  const roles = rolesFor(selectedCrew);
  $("help-title").textContent = `${selectedCrew} minds. ${roles.length} essential jobs.`;
  $("help-roles").replaceChildren(...roles.map(definition => {
    const paragraph = document.createElement("p");
    const strong = document.createElement("b");
    strong.textContent = definition.name + ": ";
    paragraph.append(strong, definition.help + ".");
    return paragraph;
  }));
}

function setMode(nextChallenge: number, nextCrew: number, announce = false) {
  const current = race.view(Date.now()).setup;
  const challenge = isChallenge(nextChallenge) ? nextChallenge : current.challenge;
  const crewSize = isCrewSize(nextCrew) ? nextCrew : current.crewSize;
  const signals = race.dispatch({ type: "configure", challenge, crewSize });
  if (signals.length) {
    if (announce) handleSignals(signals);
    return;
  }
  const view = race.view(Date.now());
  scene.setChallenge(view.setup.challenge);
  updateModeControls();
  drawRoles(); updateCourseUI(); updateHelp();
  if (announce) toast(`${challengeFor(view.setup.challenge).difficulty} · ${view.setup.crewSize}-pilot setup selected.`);
}

function updateModeControls() {
  const view = race.view(Date.now());
  const { challenge: selectedChallenge, crewSize: selectedCrew } = view.setup;
  const locked = view.configLocked;
  document.querySelectorAll<HTMLButtonElement>("[data-home-challenge], [data-lobby-challenge]").forEach(button => {
    const active = Number(button.dataset.homeChallenge ?? button.dataset.lobbyChallenge) === selectedChallenge;
    button.setAttribute("aria-pressed", String(active)); button.classList.toggle("active", active); button.disabled = locked;
  });
  document.querySelectorAll<HTMLButtonElement>("[data-home-crew], [data-lobby-crew]").forEach(button => {
    const active = Number(button.dataset.homeCrew ?? button.dataset.lobbyCrew) === selectedCrew;
    button.setAttribute("aria-pressed", String(active)); button.classList.toggle("active", active); button.disabled = locked;
  });
  const challenge = challengeFor(selectedChallenge);
  $("home-summary").innerHTML = `${selectedCrew} pilots · ${challenge.difficulty} · Exact server-timed records<br>Solo practice available. No download required.`;
  $("room-contract").textContent = `${challenge.difficulty} / ${challenge.name} · ${selectedCrew} pilots · ${rolesFor(selectedCrew).map(item => item.name).join(" + ")}`;
  $("lobby-footnote").textContent = `The host starts when every active team has all ${selectedCrew} roles. Assignments lock at countdown; reconnecting pilots resume their original role.`;
}

document.querySelectorAll<HTMLButtonElement>("[data-home-challenge], [data-lobby-challenge]").forEach(button => {
  button.onclick = () => setMode(Number(button.dataset.homeChallenge ?? button.dataset.lobbyChallenge), race.view(Date.now()).setup.crewSize, true);
});
document.querySelectorAll<HTMLButtonElement>("[data-home-crew], [data-lobby-crew]").forEach(button => {
  button.onclick = () => setMode(race.view(Date.now()).setup.challenge, Number(button.dataset.homeCrew ?? button.dataset.lobbyCrew), true);
});

function enter(view: RaceSessionView) {
  document.body.classList.add("playing");
  document.body.dataset.challenge = String(view.setup.challenge);
  scene.setChallenge(view.setup.challenge); scene.setFollow(true);
  ($("lobby") as HTMLDialogElement).close();
  ($("finish-dialog") as HTMLDialogElement).close();
  updateCourseUI();
}

function handleSignals(signals: readonly RaceSessionSignal[]) {
  for (const signal of signals) {
    const view = race.view(Date.now());
    const challenge = challengeFor(view.setup.challenge);
    if (signal.type === "leave-ranked") {
      allowRankedAdoption = false;
      reconnectAssignment = false;
      sessionStorage.removeItem(rememberedRoomKey);
      if (conn) void conn.reducers.leave({}).catch(() => {});
    } else if (signal.type === "play-started") {
      enter(view);
      drawRoles();
      if (signal.mode === "practice") {
        $("mode-label").textContent = `${challenge.difficulty.toUpperCase()} / ${view.setup.crewSize}-PILOT PRACTICE`;
        $("race-status").textContent = `${view.setup.crewSize - 1} AI TEAMMATES · YOUR ROLE IS LOCKED`;
        $("standings").textContent = "";
        toast(rolesFor(view.setup.crewSize)[view.controlledRole].help);
        beep();
      }
    } else if (signal.type === "stage-cleared") {
      toast(challenge.stages[signal.stage]?.hint ?? `All ${challenge.stages.length} objectives cleared!`);
    } else if (signal.type === "fell") {
      toast(`Back to your checkpoint. +${challenge.fallPenaltyMs / 1000} second fall penalty.`);
    } else if (signal.type === "timing-missed") {
      toast(`Missed launch window. +${challenge.timingPenaltyMs / 1000} seconds. Reset and resync.`);
    } else if (signal.type === "completed") {
      $("finish-time").textContent = formatTime(signal.finishMs);
      $("finish-label").textContent = signal.ranked ? "VERIFIED TEAM FINISH" : "PRACTICE COMPLETE / UNRANKED";
      $("finish-detail").textContent = `${challenge.difficulty} · ${view.setup.crewSize} pilots · ${view.body.falls} falls · ${view.body.mistakes} timing mistakes · ${(view.body.penaltyMs / 1000).toFixed(0)}s total penalties. ${signal.ranked ? "Saved to the matching persistent leaderboard." : "Bring your crew and turn coordination into competition."}`;
      modal("finish-dialog");
    } else if (signal.type === "ranked-ended-without-finish") {
      toast("Race ended. No finish recorded for your team. Open the lobby for a rematch.");
    } else if (signal.type === "command-rejected") {
      toast(signal.error);
    } else if (signal.type === "snapshot-rejected") {
      console.warn(`Ignored invalid Team ${signal.team + 1} snapshot: ${signal.error}`);
    }
  }
}

function startPractice() {
  clearInputs();
  handleSignals(race.dispatch({ type: "start-practice" }));
}

$("practice").onclick = startPractice;
$("sound").onclick = () => {
  muted = !muted;
  if (audio && audioMaster) audioMaster.gain.setTargetAtTime(muted ? 0 : 1, audio.currentTime, 0.012);
  $("sound").textContent = muted ? "Sound off" : "Sound on"; toast(muted ? "Sound off" : "Sound on");
};
$("help").onclick = () => modal("help-dialog");
$("exit").onclick = () => {
  handleSignals(race.dispatch({ type: "leave" }));
  clearInputs(); document.body.classList.remove("playing");
  scene.setFollow(false);
  $("countdown").textContent = ""; updateModeControls(); drawRoles();
};
$("again").onclick = () => { ($("finish-dialog") as HTMLDialogElement).close(); race.view(Date.now()).mode === "practice" ? startPractice() : modal("lobby"); };

function connectionError(message: string) {
  ready = false; $("connection").textContent = "MULTIPLAYER OFFLINE";
  $("network-error").textContent = `Multiplayer unavailable: ${message}. Solo practice is available.`;
  $("leader-list").textContent = "Unable to load verified results. The multiplayer server is unavailable.";
  ($("join") as HTMLButtonElement).disabled = false;
  const view = race.view(Date.now());
  if (view.playing && view.mode === "ranked") toast("Disconnected. Race input is paused. Open the lobby to reconnect.");
}

function adoptRoomConfig(challenge: number, crewSize: number) {
  if (!isChallenge(challenge) || !isCrewSize(crewSize)) return;
  const signals = race.dispatch({ type: "configure", challenge, crewSize });
  if (signals.length && race.view(Date.now()).mode !== "ranked") return;
  scene.setChallenge(race.view(Date.now()).setup.challenge); updateModeControls(); drawRoles(); updateCourseUI(); updateHelp();
}

const RefreshArea = {
  Simulation: 1,
  Structure: 2,
  Leaderboard: 4,
  All: 7,
} as const;
let queuedRefreshAreas = 0;
let refreshQueued = false;

function scheduleRefresh(areas: number) {
  queuedRefreshAreas |= areas;
  if (refreshQueued) return;
  refreshQueued = true;
  queueMicrotask(() => {
    refreshQueued = false;
    const pending = queuedRefreshAreas;
    queuedRefreshAreas = 0;
    refresh(pending);
  });
}

const leaderboardScope = (): LeaderboardScope => ({
  challenge: leaderboardChallenge,
  crewSize: leaderboardCrew,
});
const isCurrentLeaderboard = (scope: LeaderboardScope) =>
  scope.challenge === leaderboardChallenge && scope.crewSize === leaderboardCrew;

function ensureConnection() {
  if (ready) return;
  gameNetwork?.disconnect();
  conn = undefined;
  $("connection").textContent = "CONNECTING"; $("network-error").textContent = "Connecting to SpacetimeDB…";
  gameNetwork = connect({
    ready: network => {
      gameNetwork = network;
      conn = network.connection;
      ready = true;
      $("connection").textContent = "SPACETIMEDB CONNECTED";
      $("network-error").textContent = "";
      const me = conn.identity && conn.db.player.id.find(conn.identity);
      if (me && race.view(Date.now()).mode !== "practice") {
        ($("code") as HTMLInputElement).value = me.room;
        ($("name") as HTMLInputElement).value = me.name;
        ($("team") as HTMLSelectElement).value = String(me.team);
        reconnectAssignment = true;
        sessionStorage.setItem(rememberedRoomKey, me.room);
        network.setRoom(me.room);
      } else network.setRoom(($("code") as HTMLInputElement).value);
      refresh(RefreshArea.All);
    },
    roomData: (_code: string, kind: RoomUpdateKind) => scheduleRefresh(
      kind === "structure" ? RefreshArea.Structure | RefreshArea.Simulation : RefreshArea.Simulation,
    ),
    leaderboardData: scope => {
      if (isCurrentLeaderboard(scope)) scheduleRefresh(RefreshArea.Leaderboard);
    },
    error: connectionError,
  });
  gameNetwork.setRoom(($("code") as HTMLInputElement).value);
}

$("room-panel").onclick = () => { if (race.view(Date.now()).mode === "practice") $("exit").click(); modal("lobby"); if (!ready) ensureConnection(); };
$("open-lobby").onclick = () => { modal("lobby"); ensureConnection(); };
$("leaders").onclick = () => {
  const setup = race.view(Date.now()).setup;
  leaderboardChallenge = setup.challenge; leaderboardCrew = setup.crewSize; updateLeaderboardFilters();
  modal("leader-dialog"); ensureConnection();
  gameNetwork?.setLeaderboard(leaderboardScope());
  refresh(RefreshArea.Leaderboard);
};
$("leader-dialog").addEventListener("close", () => gameNetwork?.setLeaderboard());
$("invite").onclick = async () => {
  const url = new URL(location.href);
  url.searchParams.set("room", ($("code") as HTMLInputElement).value.toUpperCase());
  try { await navigator.clipboard.writeText(url.href); toast("Invite link copied. Send it to your crew."); }
  catch { toast("Room code: " + ($("code") as HTMLInputElement).value); }
};

function syncKnownRoom() {
  if (!ready || !conn || joinedRoom()) return;
  const code = ($("code") as HTMLInputElement).value.trim().toUpperCase();
  const room = conn.db.room.id.find(code);
  if (room) {
    adoptRoomConfig(room.challenge, room.crewSize);
    $("room-contract").textContent = `ROOM SETUP · ${challengeFor(room.challenge).difficulty} / ${challengeFor(room.challenge).name} · ${room.crewSize} pilots`;
  }
}
let roomScopeTimer: ReturnType<typeof setTimeout>;
$("code").addEventListener("input", () => {
  syncKnownRoom();
  clearTimeout(roomScopeTimer);
  roomScopeTimer = setTimeout(() => {
    if (!joinedRoom()) gameNetwork?.setRoom(($("code") as HTMLInputElement).value);
  }, 150);
});
$("part").addEventListener("change", event => selectRole(Number((event.currentTarget as HTMLSelectElement).value)));

$("join").onclick = async () => {
  if (!ready) { ensureConnection(); toast("Connecting… press Join room once connected."); return; }
  const name = ($("name") as HTMLInputElement).value.trim();
  if (!name) { $("network-error").textContent = "Choose a callsign first."; return; }
  try {
    const code = ($("code") as HTMLInputElement).value.trim().toUpperCase();
    const knownRoom = conn!.db.room.id.find(code);
    if (knownRoom) adoptRoomConfig(knownRoom.challenge, knownRoom.crewSize);
    const setup = race.view(Date.now()).setup;
    const role = Number(($("part") as HTMLSelectElement).value);
    race.dispatch({ type: "select-role", role });
    allowRankedAdoption = true;
    gameNetwork?.setRoom(code);
    await conn!.reducers.join({ code, name, teamNumber: Number(($("team") as HTMLSelectElement).value), role, challenge: setup.challenge, crewSize: setup.crewSize, ruleset: RULESET });
    sessionStorage.setItem(rememberedRoomKey, code);
    refresh(RefreshArea.All); beep();
  } catch (error) { allowRankedAdoption = false; $("network-error").textContent = String(error); }
};
$("start").onclick = async () => { try { await conn!.reducers.start({}); } catch (error) { $("network-error").textContent = String(error); } };

function updateLeaderboardFilters() {
  document.querySelectorAll<HTMLButtonElement>("[data-leader-crew]").forEach(button => {
    const active = Number(button.dataset.leaderCrew) === leaderboardCrew;
    button.setAttribute("aria-selected", String(active)); button.classList.toggle("active", active);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-leader-challenge]").forEach(button => {
    const active = Number(button.dataset.leaderChallenge) === leaderboardChallenge;
    button.setAttribute("aria-selected", String(active)); button.classList.toggle("active", active);
  });
  const challenge = challengeFor(leaderboardChallenge);
  $("leader-description").textContent = `${leaderboardCrew}-player ${challenge.difficulty} records · ${challenge.name} · Lower is better · Millisecond precision`;
}
document.querySelectorAll<HTMLButtonElement>("[data-leader-crew]").forEach(button => {
  button.onclick = () => {
    const size = Number(button.dataset.leaderCrew);
    if (isCrewSize(size)) leaderboardCrew = size;
    updateLeaderboardFilters(); gameNetwork?.setLeaderboard(leaderboardScope()); refresh(RefreshArea.Leaderboard);
  };
});
document.querySelectorAll<HTMLButtonElement>("[data-leader-challenge]").forEach(button => {
  button.onclick = () => {
    const challenge = Number(button.dataset.leaderChallenge);
    if (isChallenge(challenge)) leaderboardChallenge = challenge;
    updateLeaderboardFilters(); gameNetwork?.setLeaderboard(leaderboardScope()); refresh(RefreshArea.Leaderboard);
  };
});

function synchronizeRankedRoom() {
  if (!conn) return race.view(Date.now());
  const projection = readRankedProjection(conn);
  const before = race.view(Date.now());
  if (projection && before.mode !== "practice") {
    const sameRoom = before.mode === "ranked" && before.room?.code === projection.room.code;
    if (sameRoom || allowRankedAdoption || reconnectAssignment) {
      handleSignals(race.synchronize(projection, sameRoom ? "update" : "adopt"));
      allowRankedAdoption = false;
    }
    if (reconnectAssignment) {
      const me = conn.identity && conn.db.player.id.find(conn.identity);
      reconnectAssignment = false;
      if (me) {
        void conn.reducers.join({
          code: projection.room.code,
          name: me.name,
          teamNumber: projection.assignment.team,
          role: projection.assignment.role,
          challenge: projection.room.challenge,
          crewSize: projection.room.crewSize,
          ruleset: RULESET,
        }).catch(error => toast(String(error)));
      }
    }
  }
  return race.view(Date.now());
}

function renderRankedStructure(view: RaceSessionView) {
  if (view.mode !== "ranked" || !view.room) return;
  const { challenge: selectedChallenge, crewSize: selectedCrew } = view.setup;
  const roomCode = view.room.code;
  const myTeam = view.room.team;
  scene.setChallenge(selectedChallenge);
  updateCourseUI(); updateHelp(); drawRoles();
  const roles = rolesFor(selectedCrew);
  const members = view.members;
  $("members").replaceChildren(...members.map(player => {
    const element = document.createElement("div");
    element.textContent = `T${player.team + 1} · ${roles[player.role]?.name ?? "Unknown role"} — ${player.name}${player.online ? "" : " · DISCONNECTED / RESERVED"}`;
    return element;
  }));
  $("start").hidden = !view.room.isHost;
  setText($("start"), view.phase === "finished" ? "Race again" : "Start race");
  roles.forEach((_, index) => {
    setText($("pilot-" + index), members.find(player => player.team === myTeam && player.role === index)?.name || "NEEDED BEFORE START");
  });
  const locked = view.roleLocked;
  ($("join") as HTMLButtonElement).disabled = locked;
  for (const id of ["team", "code", "name"]) ($(id) as HTMLInputElement | HTMLSelectElement).disabled = locked;
  ($("start") as HTMLButtonElement).disabled = !view.canStart;
  $("start").title = view.room.crewReady ? `All ${selectedCrew} roles connected` : `Every active team needs ${selectedCrew} connected pilots`;
  updateModeControls();
  if (view.playing) {
    setText($("mode-label"), `${challengeFor(selectedChallenge).difficulty.toUpperCase()} · TEAM ${myTeam + 1} / ROOM ${roomCode}`);
    setText($("race-status"), view.phase.toUpperCase());
  }
}

function renderStandings(view: RaceSessionView) {
  if (view.mode !== "ranked" || !view.playing) return;
  const labels = [...view.teams]
    .sort((a, b) => (a.finishMs || Infinity) - (b.finishMs || Infinity))
    .map(team => `TEAM ${team.number + 1} · ${team.finishMs ? formatTime(team.finishMs) : `${team.body.stage}/${challengeFor(team.body.challenge).stages.length} objectives`}`);
  const container = $("standings");
  if (container.children.length !== labels.length) {
    container.replaceChildren(...labels.map(label => {
      const element = document.createElement("div");
      element.textContent = label;
      return element;
    }));
    return;
  }
  labels.forEach((label, index) => setText(container.children[index] as HTMLElement, label));
}

let leaderboardFingerprint = "";
function renderLeaderboard() {
  if (!conn) return;
  const results = [...conn.db.result.iter()]
    .filter(result => result.ruleset === RULESET && result.crewSize === leaderboardCrew && result.challenge === leaderboardChallenge)
    .sort((a, b) => a.timeMs - b.timeMs).slice(0, 15);
  const fingerprint = `${leaderboardChallenge}:${leaderboardCrew}|${results.map(result => `${result.id}:${result.timeMs}:${result.names}`).join("|")}`;
  if (fingerprint === leaderboardFingerprint) return;
  leaderboardFingerprint = fingerprint;
  $("leader-list").replaceChildren(...results.map((result, index) => {
    const row = document.createElement("div"); row.className = "leader-row";
    const rank = document.createElement("span"); rank.textContent = String(index + 1).padStart(2, "0");
    const names = document.createElement("span"); names.textContent = result.names;
    const time = document.createElement("strong"); time.textContent = formatTime(result.timeMs);
    row.append(rank, names, time); return row;
  }));
  if (!results.length) setText($("leader-list"), `No ${leaderboardCrew}-player ${challengeFor(leaderboardChallenge).difficulty} finishes yet. Your crew can set the first exact time.`);
}

function refresh(areas: number = RefreshArea.All) {
  if (!ready || !conn) return;
  const roomChanged = Boolean(areas & (RefreshArea.Simulation | RefreshArea.Structure));
  const view = roomChanged ? synchronizeRankedRoom() : race.view(Date.now());
  if (areas & RefreshArea.Structure) {
    if (view.mode === "ranked") renderRankedStructure(view);
    else syncKnownRoom();
  }
  if (roomChanged) renderStandings(view);
  if (areas & RefreshArea.Leaderboard) renderLeaderboard();
}

function input(): Input {
  if (document.querySelector("dialog[open]")) return { x: 0, z: 0, action: false };
  const pressed = (key: string) => keys.has(key) || controlKeys.has(key);
  return {
    x: (pressed("d") || pressed("arrowright") ? 1 : 0) - (pressed("a") || pressed("arrowleft") ? 1 : 0),
    z: (pressed("w") || pressed("arrowup") ? 1 : 0) - (pressed("s") || pressed("arrowdown") ? 1 : 0),
    action: pressed(" "),
  };
}

window.addEventListener("keydown", event => {
  if (document.querySelector("dialog[open]")) return;
  const key = event.key.toLowerCase();
  if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) event.preventDefault();
  keys.add(key);
});
window.addEventListener("keyup", event => keys.delete(event.key.toLowerCase()));
window.addEventListener("blur", clearInputs);
document.addEventListener("visibilitychange", clearInputs);
document.querySelectorAll<HTMLElement>("[data-key]").forEach(element => {
  const mappedKey = element.dataset.key!;
  let pointerActive = false;
  let keyboardActive = false;
  let pulseActive = false;
  let pulseTimer: ReturnType<typeof setTimeout> | undefined;
  const sync = () => {
    if (pointerActive || keyboardActive || pulseActive) controlKeys.add(mappedKey);
    else controlKeys.delete(mappedKey);
  };
  const clearPulse = () => {
    pulseActive = false;
    clearTimeout(pulseTimer);
  };
  const reset = () => {
    pointerActive = false;
    keyboardActive = false;
    clearPulse();
    controlKeyboardActive.delete(element);
    sync();
  };
  controlResetters.add(reset);
  element.onpointerdown = event => {
    clearPulse();
    pointerActive = true;
    element.setPointerCapture(event.pointerId);
    sync();
  };
  element.onpointerup = element.onpointercancel = element.onlostpointercapture = () => {
    pointerActive = false;
    sync();
  };
  element.onkeydown = event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    clearPulse();
    keyboardActive = true;
    controlKeyboardActive.add(element);
    sync();
  };
  element.onkeyup = event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    keyboardActive = false;
    sync();
    setTimeout(() => controlKeyboardActive.delete(element), 0);
  };
  element.onblur = () => {
    keyboardActive = false;
    clearPulse();
    controlKeyboardActive.delete(element);
    sync();
  };
  element.onclick = event => {
    if (event.detail !== 0 || controlKeyboardActive.has(element)) return;
    clearPulse();
    pulseActive = true;
    sync();
    pulseTimer = setTimeout(() => {
      pulseActive = false;
      sync();
    }, 160);
  };
});

setInterval(() => {
  const view = race.view(Date.now());
  if (ready && view.canSendInput && conn) void conn.reducers.input(input()).catch(error => toast(String(error)));
}, 50);

function updateActionLabel(view = race.view(Date.now())) {
  const button = document.querySelector<HTMLButtonElement>(".touch .grab");
  if (!button) return;
  const { body, controlledRole: role } = view;
  const stage = challengeFor(body.challenge).stages[body.stage];
  const label = stage?.kind === "finalTiming"
    ? "SYNC"
    : stage?.kind === "duck" && (view.setup.crewSize === 3 ? role === 1 : role === 2)
      ? "BEND"
      : rolesFor(view.setup.crewSize)[role]?.action ?? "ACT";
  setText(button, label);
}

function roleFeedback(view: RaceSessionView) {
  const { body, controlledRole: role } = view;
  const stage = challengeFor(body.challenge).stages[body.stage];
  if (!stage) return "Course complete";
  if (stage.kind === "finalTiming") {
    return finaleRoleCopy(finaleCueState(body));
  }
  if (body.crewSize === 3) {
    if (role === 0) return securelyHeld(body) ? "BOTH HANDS SECURE" : `LEFT ${body.handGrip[0] >= 0 ? "HELD" : "OPEN"} · RIGHT ${body.handGrip[1] >= 0 ? "HELD" : "OPEN"}`;
    if (role === 1) return body.bend ? "BENT LOW · keep moving" : body.brace ? "BRACED · absorbing movement" : "Hold ACT to brace or bend";
    return stage.kind === "switches" ? `BOTH SWITCHES ${Math.round(Math.min(...body.feet) * 100)}%` : "Drive both feet · coordinate pace with Torso";
  }
  if (role < 2) return body.handGrip[role] >= 0 ? `${role ? "RIGHT" : "LEFT"} HAND HOLDING · match the other hand` : `${role ? "RIGHT" : "LEFT"} HAND OPEN · move into contact`;
  if (role === 2) return body.bend ? "BENT LOW · keep moving" : body.brace ? "BRACED · stabilizing the crew" : "Hold ACT to brace or bend";
  const foot = role - 3;
  return stage.kind === "switches" ? `${foot ? "RIGHT" : "LEFT"} SWITCH ${Math.round(body.feet[foot] * 100)}%` : `Drive the ${foot ? "right" : "left"} foot · match the other leg`;
}

let previous = performance.now();
function frame(timestamp: number) {
  const delta = Math.min((timestamp - previous) / 1000, 0.1); previous = timestamp;
  handleSignals(race.advance(delta, input(), !document.querySelector("dialog[open]")));
  const view = race.view(Date.now());
  const { body } = view;
  if (view.playing) {
    const challenge = challengeFor(body.challenge), stage = challenge.stages[body.stage];
    setText($("countdown"), view.countdownSeconds > 0 ? String(view.countdownSeconds) : "");
    setText($("timer"), formatTime(view.elapsedMs));
    setText($("objective-title"), body.finished ? "MISSION COMPLETE" : `${body.stage + 1} / ${challenge.stages.length} · ${stage.name}`);
    setText($("objective-hint"), stage?.hint ?? "Your crew made it home.");
    setProgress($("objective-progress"), body.finished ? 1 : stageProgressValue(body));
    setData($("objective-panel"), "stage", String(body.stage));
    setText($("role-feedback"), roleFeedback(view));
    const finaleState = finaleCueState(body);
    setText($("sync-signal"), finaleState === "inactive"
      ? `${challenge.fallPenaltyMs / 1000}s FALL PENALTY`
      : finaleSignalCopy(finaleState));
    $("sync-signal").classList.toggle("aligned", finaleState === "align" || finaleState === "locked");
    setText($("sync-announcement"), finaleAnnouncement(finaleState));
    challenge.stages.forEach((_, index) => {
      $("stage-" + index).classList.toggle("current", body.stage === index);
      $("stage-" + index).classList.toggle("complete", body.stage > index);
    });
    updateActionLabel(view);
  } else setText($("sync-announcement"), "");
  renderBodies.clear();
  for (const team of view.teams) renderBodies.set(team.number, team.body);
  const attemptId = view.room
    ? `${view.room.code}:${view.room.matchId ?? "lobby"}`
    : `${view.mode}:${view.setup.challenge}:${view.setup.crewSize}`;
  scene.update(renderBodies, view.room?.team ?? 0, attemptId, timestamp / 1000, delta);
  if (view.playing) gameFeedback.update(attemptId, body);
  else gameFeedback.reset();
  requestAnimationFrame(frame);
}

const invited = new URL(location.href).searchParams.get("room");
const initialRoom = normalizeRoomCode(invited ?? sessionStorage.getItem(rememberedRoomKey) ?? undefined);
if (initialRoom) ($("code") as HTMLInputElement).value = initialRoom;
if (invited) modal("lobby");
updateModeControls(); drawRoles(); updateCourseUI(); updateHelp(); updateLeaderboardFilters();
ensureConnection(); requestAnimationFrame(frame);
