"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchLeaderboard, type LeaderboardStatus } from "@/game/leaderboard-http";
import { LEADERBOARD_LIMIT, topScoreRows, type ScoreRow, type SquadSize } from "@/game/scores";
import { CHALLENGES, formatTime } from "@/game/types";
import { ChallengeIcon, CloseIcon, TrophyIcon } from "@/components/icons";

const SHOWN = LEADERBOARD_LIMIT;

/**
 * The top bar's "Best times" button. The scoreboard opens in a modal dialog
 * and is only mounted (and fetched) on the first click, so the landing page
 * never loads scores nobody asked for.
 */
export default function LandingLeaderboardButton() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [opened, setOpened] = useState(false);

  const open = () => {
    setOpened(true);
    dialogRef.current?.showModal();
  };
  const close = () => dialogRef.current?.close();

  return (
    <>
      <button type="button" onClick={open} aria-haspopup="dialog" className="lab-btn lab-btn--plain lab-board-open">
        <TrophyIcon className="h-5 w-5" />
        <span className="max-[440px]:sr-only">Best times</span>
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby="lab-board-title"
        className="lab-board-dialog"
        // A click on the backdrop lands on the dialog element itself.
        onClick={(e) => e.target === e.currentTarget && close()}
      >
        {opened && <LandingLeaderboard onClose={close} />}
      </dialog>
    </>
  );
}

/**
 * The scoreboard sticker: top ranked runs per course, read from the
 * edge-cached `/api/leaderboard` when it mounts. Every failure mode degrades
 * to a quiet note.
 */
function LandingLeaderboard({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<ScoreRow[]>([]);
  const [status, setStatus] = useState<LeaderboardStatus>("loading");
  const [course, setCourse] = useState(CHALLENGES[0].id);
  const [squad, setSquad] = useState<SquadSize>(5);

  useEffect(() => {
    const controller = new AbortController();
    fetchLeaderboard(controller.signal)
      .then((next) => {
        setRows(next);
        setStatus("ok");
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("unavailable");
      });
    return () => controller.abort();
  }, []);

  const board = useMemo(() => topScoreRows(rows, course, squad, SHOWN), [rows, course, squad]);
  const challenge = CHALLENGES.find((c) => c.id === course) ?? CHALLENGES[0];

  return (
    <section className="lab-board" aria-labelledby="lab-board-title" data-testid="landing-leaderboard">
      <div className="lab-board-head">
        <div className="min-w-0">
          <h2 id="lab-board-title" className="lab-board-title">
            Best times
          </h2>
          <p className="lab-board-course-name">
            {challenge.name} · {squad === 5 ? "5-player squads" : "3-player squads & solo"}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close best times" className="lab-board-chip lab-board-close">
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="lab-board-controls">
        <div role="group" aria-label="Course" className="lab-board-courses">
          {CHALLENGES.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={course === c.id}
              aria-label={c.name}
              title={c.name}
              onClick={() => setCourse(c.id)}
              className="lab-board-course"
            >
              <ChallengeIcon challenge={c} className="h-4 w-4" />
            </button>
          ))}
        </div>
        <div role="group" aria-label="Squad size" className="lab-board-squads">
          {([5, 3] as SquadSize[]).map((n) => (
            <button key={n} type="button" aria-pressed={squad === n} onClick={() => setSquad(n)} className="lab-board-chip">
              {n}P
            </button>
          ))}
        </div>
      </div>
      <ol className="lab-board-rows" aria-live="polite" aria-busy={status === "loading" || undefined}>
        {status === "loading" &&
          Array.from({ length: SHOWN }, (_, i) => (
            <li key={i} className="lab-board-row is-skeleton" aria-hidden="true">
              <span className="lab-board-place">{i + 1}</span>
              <span className="lab-board-bar" />
            </li>
          ))}
        {status === "unavailable" && <li className="lab-board-empty">Scores are taking a breather. The game works fine without them.</li>}
        {status === "ok" && board.length === 0 && <li className="lab-board-empty">No ranked runs yet. Your squad could be first.</li>}
        {status === "ok" &&
          board.map((row, i) => (
            <li key={row.id} className="lab-board-row">
              <span className="lab-board-place">{i + 1}</span>
              <span className="lab-board-team">
                <span className="lab-board-team-name">{row.teamName}</span>
                <span className="lab-board-players">{row.players.join(", ")}</span>
              </span>
              <span className="lab-board-time">{formatTime(row.timeMs)}</span>
            </li>
          ))}
      </ol>
    </section>
  );
}
