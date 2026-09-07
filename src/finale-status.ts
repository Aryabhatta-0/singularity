import {
  challengeFor,
  finaleNeedsRelease,
  isAtFinaleGate,
  isFinaleInputWindow,
  type Body,
} from "../shared/physics.ts";

export type FinaleCueState =
  | "inactive"
  | "locked"
  | "missed"
  | "rearm"
  | "approach"
  | "align"
  | "wait";

export function finaleCueState(body: Body): FinaleCueState {
  if (challengeFor(body.challenge).stages[body.stage]?.kind !== "finalTiming") return "inactive";
  if (body.syncStarted) return "locked";
  if (body.lockout > 0) return "missed";
  if (finaleNeedsRelease(body)) return "rearm";
  if (!isAtFinaleGate(body)) return "approach";
  return isFinaleInputWindow(body) ? "align" : "wait";
}

export function finaleRoleCopy(state: FinaleCueState) {
  switch (state) {
    case "locked": return "SYNC LOCKED · keep holding ACT";
    case "missed": return "MISSED BEAT · every pilot release ACT";
    case "rearm": return "RELEASE ACT · re-arm for a fresh synchronized press";
    case "approach": return "REACH THE LAUNCH GATE · keep ACT released";
    case "align": return "ALIGN · every pilot press ACT together";
    case "wait": return "WAIT · release ACT and watch the launch rings";
    case "inactive": return "";
  }
}

export function finaleSignalCopy(state: FinaleCueState) {
  switch (state) {
    case "locked": return "SYNC LOCKED · HOLD";
    case "missed": return "MISSED BEAT · RELEASE";
    case "rearm": return "RELEASE TO RE-ARM";
    case "approach": return "REACH LAUNCH GATE";
    case "align": return "ALIGN · ACT TOGETHER";
    case "wait": return "WAIT · RELEASE ACT";
    case "inactive": return "";
  }
}

export function finaleAnnouncement(state: FinaleCueState) {
  switch (state) {
    case "locked": return "Sync locked. Keep holding action.";
    case "missed": return "Missed beat. Every pilot release action.";
    case "rearm": return "Release action to re-arm for a fresh synchronized press.";
    case "approach": return "Reach the launch gate. Keep action released.";
    case "align": return "Alignment window open. All pilots press action together now.";
    case "wait": return "Window closed. Release action and wait.";
    case "inactive": return "";
  }
}
