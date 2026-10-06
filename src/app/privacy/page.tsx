import type { Metadata } from "next";
import LegalPage, { ISSUES_URL, PRIVATE_REPORT_URL, REPO_URL } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Singularity keeps when you play (very little), why it keeps it, when it deletes it and how to remove it.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      updated="October 6, 2026"
      intro={
        <p>
          Singularity is a free game that you play in your web browser. You do not make an account. We show no ads. We
          do not track you. The game must keep a small quantity of information to let you play with other people. This
          page tells you all of it.
        </p>
      }
    >
      <h2>What we keep, and why</h2>
      <dl className="lab-legal-list">
        <dt>Your name</dt>
        <dd>
          You can type a name of up to 16 letters. Your browser remembers it, so you do not type it again. Other players
          in your room see it. Use a nickname. You do not have to give your real name.
        </dd>
        <dt>What happens in your game</dt>
        <dd>
          While you play, the game keeps your room, your team, your body part and your moves. This lets all players in
          the room see the same race. Players in other rooms cannot see it.
        </dd>
        <dt>A random player number</dt>
        <dd>
          Each browser tab gets a random number. The game uses it to know which player you are. If your internet stops
          for a short time, it puts you back in your seat. This number does not tell us who you are.
        </dd>
        <dt>Best times</dt>
        <dd>
          If your team gets one of the ten best times on a course, the game keeps your team name, the names of the
          players and the time. <strong>All visitors to the website can see the best times.</strong>
        </dd>
        <dt>Your internet address</dt>
        <dd>
          When your browser connects to a website, the website gets your internet address (IP address). The companies
          that run our website can keep this for a short time to stop attacks. Our game uses it only to stop too many
          connections from one place. We do not keep it.
        </dd>
      </dl>

      <h2>What we do not do</h2>
      <ul>
        <li>We do not ask for your email, phone number, payment details or where you live.</li>
        <li>We do not use ads or tools that watch what you do.</li>
        <li>We do not use cookies.</li>
        <li>We do not sell or share your information.</li>
      </ul>

      <h2>What stays in your browser</h2>
      <p>
        Your browser keeps two small items: your name and your random player number. Your name stays until you delete
        it. The player number goes away when you close the tab. The game needs both to work. You can delete them at any
        time in your browser settings. Then the game asks for your name again.
      </p>

      <h2>Who helps us run the game</h2>
      <ul>
        <li>
          <strong>Vercel</strong> runs our website.
        </li>
        <li>
          <strong>SpacetimeDB</strong> (Clockwork Labs) runs the game server. The game server keeps the rooms and the
          best times.
        </li>
      </ul>
      <p>
        These companies can keep your information on computers in other countries, for example in the United States.
        They work for us only to run the game. If a friend runs the game on their own computer, this page does not
        apply. In that case, your information stays on their computer.
      </p>

      <h2>When we delete it</h2>
      <ul>
        <li>When all players leave a room, the game deletes the room.</li>
        <li>If you lose your connection, the game removes you after approximately 30 seconds.</li>
        <li>The game deletes your moves after one second.</li>
        <li>If a better team pushes your time out of the top ten, the game deletes your time.</li>
        <li>Your random player number stops working after six hours.</li>
        <li>When you practice alone without the internet, nothing leaves your browser.</li>
      </ul>

      <h2>Your rights</h2>
      <p>
        The law where you live can give you the right to see, correct or delete your information. Examples are
        India&apos;s Digital Personal Data Protection Act, 2023 and some US state laws. Most people ask us to remove a
        name from the best times. To ask a question, make a request or complain:
      </p>
      <ul>
        <li>
          Write to us on{" "}
          <a href={ISSUES_URL} rel="noopener">
            GitHub
          </a>
          . Tell us the course and the time of the entry. Do not include other personal details.
        </li>
        <li>
          If you do not want to write in public, use{" "}
          <a href={PRIVATE_REPORT_URL} rel="noopener">
            GitHub&apos;s private form
          </a>
          . Only the game makers can read it.
        </li>
      </ul>
      <p>We try to reply in 30 days or less. You can also delete the items in your browser yourself.</p>

      <h2>Children</h2>
      <p>
        Singularity is a game for all ages. We do not ask for your age. We do not try to get information about
        children under 13. If you are under 18, get permission from a parent or guardian before you play. Use a
        nickname, not your real name. A parent or guardian can ask us to remove a child&apos;s name from the best
        times.
      </p>

      <h2>Safety</h2>
      <p>
        All connections to the game are encrypted. The game server accepts only players who come from this website.
        Each room can see only its own information. The game server checks all information that players send. No system
        is fully safe. If you find a problem, read our{" "}
        <a href={`${REPO_URL}/blob/main/SECURITY.md`} rel="noopener">
          security policy
        </a>{" "}
        to tell us about it.
      </p>

      <h2>Changes to this page</h2>
      <p>
        If the game starts to keep different information, we will change this page and its date. You can see all
        earlier versions in our{" "}
        <a href={REPO_URL} rel="noopener">
          code
        </a>
        .
      </p>
    </LegalPage>
  );
}
