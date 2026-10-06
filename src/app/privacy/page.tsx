import type { Metadata } from "next";
import LegalPage, { ISSUES_URL, PRIVATE_REPORT_URL, REPO_URL } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Singularity collects when you play (very little), where it goes, how long it stays and how to have it removed.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      updated="October 6, 2026"
      intro={
        <p>
          Singularity is a free, open-source browser game. There are no accounts, no ads, no analytics and no tracking
          cookies. To run online rooms and a leaderboard it has to handle a small amount of data, described here in full.
          The source code is public, so you can check every claim below.
        </p>
      }
    >
      <h2>What we handle, and why</h2>
      <dl className="lab-legal-list">
        <dt>The name you type</dt>
        <dd>
          Your display name (up to 16 characters) is saved in your browser so you don&apos;t retype it, and sent to the
          game server when you join a room so other players see who has which limb. Use a nickname; you never need to
          enter your real name.
        </dd>
        <dt>Room and gameplay data</dt>
        <dd>
          While you play, the game server keeps your room code, team, chosen body part, ready state, control inputs and
          the physics state of your body, so everyone in the room sees the same race. Other rooms cannot see any of it.
        </dd>
        <dt>A random session identity</dt>
        <dd>
          Each browser tab gets a random session token from this site, so the game server can tell players apart and
          give you your seat back after a dropped connection. It contains no personal information and is kept only in
          that tab&apos;s session storage.
        </dd>
        <dt>Leaderboard entries</dt>
        <dd>
          When a full squad (or a solo free-for-all racer) sets one of the ten best times on a course, the server
          records the course, squad size, team name, the display names of the people on that team and the time. These
          entries are <strong>public</strong>: anyone visiting the site can see them.
        </dd>
        <dt>Network information</dt>
        <dd>
          Like any website, our hosting provider and game database provider receive your IP address and basic request
          details (browser type, time) when your browser connects, and may keep short-term logs for security and
          reliability. Our own code uses your IP address only in memory, to rate-limit how often new sessions can be
          created; we do not store it.
        </dd>
      </dl>

      <h2>What we don&apos;t do</h2>
      <ul>
        <li>No accounts, emails, phone numbers, payment details or precise location.</li>
        <li>No analytics, advertising or social-media trackers, and no crash-reporting service.</li>
        <li>No cookies. The game uses browser storage only for the two items above.</li>
        <li>We do not sell or share personal information, or use it for targeted advertising or profiling.</li>
      </ul>

      <h2>Your browser&apos;s storage</h2>
      <p>
        <code>localStorage</code> keeps <code>singularity_name</code> (your display name) until you clear it.{" "}
        <code>sessionStorage</code> keeps <code>singularity:session-token</code> until you close the tab. Both are
        strictly needed for the features you use, and you can delete them at any time through your browser settings;
        the game will simply ask again.
      </p>

      <h2>Who processes it</h2>
      <ul>
        <li>
          <strong>Vercel</strong> hosts the website and the small server functions that sign session tokens and serve
          the leaderboard.
        </li>
        <li>
          <strong>SpacetimeDB Maincloud</strong> (Clockwork Labs) runs the game database that holds live rooms and the
          leaderboard. Access to it is restricted to signed game sessions.
        </li>
      </ul>
      <p>
        These providers may process data on servers outside your country, including in the United States. They act on
        our behalf to run the game; their own privacy policies describe their logging. If you play on a copy someone
        else hosts (for example on a local network with <code>npm run host</code>), that host runs everything on their
        own machine and this policy does not cover it.
      </p>

      <h2>How long it stays</h2>
      <ul>
        <li>Room data is deleted automatically when the room empties, and a player who disconnects is removed after about 30 seconds.</li>
        <li>Control inputs expire within a second; physics snapshots are replaced many times per second and deleted with the round.</li>
        <li>Leaderboard entries stay while they are among the ten best on their board and are deleted automatically once pushed off it.</li>
        <li>Session tokens expire after six hours. Offline practice never leaves your browser.</li>
      </ul>

      <h2>Your choices and rights</h2>
      <p>
        Depending on where you live (for example under India&apos;s Digital Personal Data Protection Act, 2023, or US state
        privacy laws) you may have rights to access, correct or delete personal data about you, and to raise a
        grievance. Because we hold so little, the most common request is removing a leaderboard entry or name. To ask,
        or for any privacy question or complaint:
      </p>
      <ul>
        <li>
          Open an issue on{" "}
          <a href={ISSUES_URL} rel="noopener">
            GitHub
          </a>{" "}
          with the course and time of the entry (no other personal details needed), or
        </li>
        <li>
          if you&apos;d rather not post publicly, send a private report through{" "}
          <a href={PRIVATE_REPORT_URL} rel="noopener">
            GitHub&apos;s private reporting form
          </a>
          , which only the maintainers can read.
        </li>
      </ul>
      <p>We aim to respond within 30 days. You can always clear your browser storage yourself.</p>

      <h2>Children</h2>
      <p>
        Singularity is a general-audience game and does not ask for anyone&apos;s age or identity. We do not knowingly
        collect personal information from children under 13. If you are under 18, please play with a parent or
        guardian&apos;s permission and use a made-up nickname. A parent or guardian can ask us to remove a child&apos;s
        name from the leaderboard using the contacts above.
      </p>

      <h2>Security</h2>
      <p>
        Connections use HTTPS and secure WebSockets. The game database refuses connections without a signed session
        from this site, keeps each room&apos;s data visible only to that room, and validates everything players send. No
        system is perfectly secure; if you find a problem, please report it as described in our{" "}
        <a href={`${REPO_URL}/blob/main/SECURITY.md`} rel="noopener">
          security policy
        </a>
        .
      </p>

      <h2>Changes</h2>
      <p>
        If what the game collects changes, we will update this page and its date. The history of every change is
        public in the{" "}
        <a href={REPO_URL} rel="noopener">
          repository
        </a>
        .
      </p>
    </LegalPage>
  );
}
