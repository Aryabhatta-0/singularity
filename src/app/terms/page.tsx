import type { Metadata } from "next";
import Link from "next/link";
import LegalPage, { ISSUES_URL, REPO_URL } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Terms",
  description: "The rules for Singularity online: be kind, do not break the game for other players and accept the game as it is.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of use"
      updated="October 6, 2026"
      intro={
        <p>
          These rules apply when you play Singularity on this website. They are short. When you play, you agree to
          them. If you do not agree, do not use this website. You can still use the code under its license.
        </p>
      }
    >
      <h2>The game</h2>
      <p>
        Singularity is a free game. Hobbyists make it, and its code is public. You do not need an account. We can
        change, pause or stop the game at any time. We can also reset rooms or change features. We do not promise that
        the game is always available or that it has no errors.
      </p>

      <h2>Play fair and be kind</h2>
      <ul>
        <li>Do not use names that are hateful, rude or sexual.</li>
        <li>Do not use the name or private information of a different person.</li>
        <li>Do not cheat to get on the best times. For example, do not change the game or use a program to play for you.</li>
        <li>Do not attack the website or the game server. Do not try to stop other players&apos; games.</li>
        <li>Obey the laws that apply to you.</li>
      </ul>
      <p>
        If you break these rules, we can remove your name, your best times or you. We can also block access that
        causes damage. We do not have to tell you first.
      </p>

      <h2>What you put in the game</h2>
      <p>
        Other players see the names that you type. All visitors can see the best times. You keep your rights to these
        names. You let us keep and show them so that the game can work. Read the{" "}
        <Link href="/privacy">privacy page</Link> to learn what we keep and for how long.
      </p>

      <h2>The code</h2>
      <p>
        The code is free to use under the{" "}
        <a href={`${REPO_URL}/blob/main/LICENSE`} rel="noopener">
          MIT License
        </a>
        . The parts that other people made have their own free licenses. These rules apply only to this website. They
        do not change what the license lets you do with the code.
      </p>

      <h2>No promises</h2>
      <p>
        We give you the game &ldquo;as is&rdquo;. We make no promises about it, as far as the law allows. As far as the
        law allows, the makers of Singularity are not responsible for losses that come from the game. This includes
        lost data or lost progress. These rules do not remove rights that the law gives you.
      </p>

      <h2>Changes and questions</h2>
      <p>
        We can change these rules. The date at the top shows the latest version. If you continue to play, you accept
        the changes. For questions or reports,{" "}
        <a href={ISSUES_URL} rel="noopener">
          write to us on GitHub
        </a>
        .
      </p>
    </LegalPage>
  );
}
