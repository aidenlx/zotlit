// The `/learn` top bar: the wordmark, a mono "Learn" label, then "All
// lessons" and "Docs" as muted links, over a hairline. See DESIGN.md → Learn.

import { Link } from "@tanstack/react-router";

import { Logo } from "@/components/logo";
import * as m from "@/paraglide/messages.js";

const linkClass =
  "rounded-sm px-1 py-1.5 text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring";

export function LearnHeader() {
  return (
    <header className="flex items-center gap-3 border-b border-fd-border px-5 py-3">
      <Link
        to="/"
        aria-label="ZotLit"
        className="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring"
      >
        <Logo small className="text-lg" />
      </Link>
      <span className="font-mono text-[11px] font-medium tracking-[0.08em] text-fd-muted-foreground uppercase">
        {m.docs_nav_learn()}
      </span>
      <span className="flex-1" />
      <nav className="flex items-center gap-2">
        <Link to="/learn" className={linkClass}>
          {m.docs_learn_all_lessons()}
        </Link>
        <Link to="/docs" className={linkClass}>
          {m.docs_nav_docs()}
        </Link>
      </nav>
    </header>
  );
}
