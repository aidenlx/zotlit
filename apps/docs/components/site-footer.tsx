// Shared copyright footer for the (home) index surfaces (landing, blog, changelog).

import { gitConfig } from "@/lib/shared";

export function SiteFooter() {
  return (
    <footer className="flex flex-wrap justify-between gap-3 border-t border-fd-border py-6 text-sm text-fd-muted-foreground">
      <span>
        © 2022–{new Date().getFullYear()} AidenLx ·{" "}
        <a
          href={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/LICENSE`}
          target="_blank"
          rel="noreferrer noopener"
          className="underline decoration-fd-border underline-offset-4 transition-colors hover:text-fd-primary hover:decoration-fd-primary"
        >
          AGPL-3.0 Licensed
        </a>
      </span>
    </footer>
  );
}
