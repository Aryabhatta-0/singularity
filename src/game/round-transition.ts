export interface PlayingTransitionPlan {
  prepare: boolean;
  start: boolean;
}

interface PlayingTransitionState {
  running: boolean;
  finished: boolean;
  observedRound: number;
  currentRound: number;
}

/**
 * Decide how the client should respond to the authoritative `playing` phase.
 * A round already observed during countdown is prepared but still needs to be
 * started when the server transition wins the race with the local timer.
 */
export function planPlayingTransition({
  running,
  finished,
  observedRound,
  currentRound,
}: PlayingTransitionState): PlayingTransitionPlan {
  if (running || finished) return { prepare: false, start: false };
  return {
    prepare: observedRound !== currentRound,
    start: true,
  };
}
