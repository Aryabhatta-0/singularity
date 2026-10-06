import type { Metadata } from "next";
import Link from "next/link";
import LegalPage, { ISSUES_URL, REPO_URL } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Terms",
  description: "The ground rules for playing Singularity online: be decent, don't break the game for others, and enjoy it as-is.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of use"
      updated="October 6, 2026"
      intro={
        <p>
          These terms cover playing Singularity at this website. They are short on purpose. By playing, you agree to
          them; if you don&apos;t, please don&apos;t use the online service (the code is yours to run under its license either way).
        </p>
      }
    >
      <h2>The game</h2>
      <p>
        Singularity is a free, open-source hobby project. You can play without an account. We may change, pause or stop
        the online service, reset rooms, or adjust features at any time, and we don&apos;t promise it will always be
        available or free of bugs.
      </p>

      <h2>Play fair, be decent</h2>
      <ul>
        <li>Choose display and team names that aren&apos;t hateful, harassing, sexually explicit, impersonating someone, or someone else&apos;s private information.</li>
        <li>Don&apos;t cheat the leaderboard, for example with modified clients or scripted runs.</li>
        <li>Don&apos;t attack, overload, scrape or try to break into the website or the game server, or interfere with other players&apos; rooms.</li>
        <li>Follow the laws that apply to you.</li>
      </ul>
      <p>
        We may remove names, leaderboard entries or players that break these rules, and block access that harms the
        service, without notice.
      </p>

      <h2>What you put in the game</h2>
      <p>
        Names you enter are shown to other players, and leaderboard entries are public. You keep any rights you have in
        them, and let us store and display them to run the game. See the{" "}
        <Link href="/privacy">privacy page</Link> for exactly what is kept and for how long.
      </p>

      <h2>The software</h2>
      <p>
        The source code is available under the{" "}
        <a href={`${REPO_URL}/blob/main/LICENSE`} rel="noopener">
          MIT License
        </a>
        , and the third-party libraries it uses are under their own open-source licenses. These terms cover the online
        service only; they don&apos;t limit what the license lets you do with the code.
      </p>

      <h2>No warranty</h2>
      <p>
        The service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without warranties of any kind, to the
        fullest extent the law allows. To the same extent, the people who make Singularity are not liable for any
        indirect or consequential loss, or for lost data or progress, arising from your use of it. Nothing here limits
        rights you have that cannot be limited by law.
      </p>

      <h2>Changes and contact</h2>
      <p>
        We may update these terms; the date above shows the latest version, and continuing to play means you accept it.
        Questions or reports:{" "}
        <a href={ISSUES_URL} rel="noopener">
          open an issue on GitHub
        </a>
        .
      </p>
    </LegalPage>
  );
}
