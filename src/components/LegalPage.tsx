import Link from "next/link";
import type { ReactNode } from "react";

export const REPO_URL = "https://github.com/Aryabhatta-0/singularity";
export const ISSUES_URL = `${REPO_URL}/issues/new/choose`;
export const PRIVATE_REPORT_URL = `${REPO_URL}/security/advisories/new`;

/** Shared shell for the legal pages: the lab top bar, one paper sheet, the site footer. */
export default function LegalPage({
  title,
  updated,
  intro,
  children,
}: {
  title: string;
  updated: string;
  intro: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="lab-landing lab-legal min-h-dvh">
      <header className="lab-topbar">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-3">
          <Link href="/" className="lab-wordmark lab-wordmark--link" aria-label="Singularity home">
            SINGULARITY
          </Link>
          <Link href="/" className="lab-btn lab-btn--plain lab-legal-back">
            Play
          </Link>
        </div>
      </header>
      <article className="lab-legal-sheet mx-auto max-w-3xl">
        <h1 className="lab-legal-title">{title}</h1>
        <p className="lab-legal-updated">Last updated {updated}</p>
        <div className="lab-legal-intro">{intro}</div>
        <div className="lab-legal-body">{children}</div>
      </article>
      <footer className="lab-footer mx-auto max-w-6xl px-5 pb-10 pt-10 text-center">
        <nav aria-label="Site" className="lab-foot-links">
          <Link href="/">Home</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <a href={REPO_URL} rel="noopener">
            Source code
          </a>
        </nav>
      </footer>
    </main>
  );
}
