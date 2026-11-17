// Shared copyright footer for the (home) index surfaces (landing, blog, changelog).

import { currentYear, gitConfig } from "@/lib/shared";
import * as m from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";

export function SiteFooter() {
  return (
    <footer className="flex flex-wrap justify-between gap-3 border-t border-fd-border py-6 text-sm text-fd-muted-foreground">
      <span>
        © 2022–{currentYear()} AidenLx ·{" "}
        <a
          href={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/LICENSE`}
          target="_blank"
          rel="noreferrer noopener"
          className="underline decoration-fd-border underline-offset-4 transition-colors hover:text-fd-primary hover:decoration-fd-primary"
        >
          {m.docs_license()}
        </a>
      </span>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <a
          href={localizeHref("/privacy")}
          className="underline underline-offset-4 hover:text-fd-primary"
        >
          {m.docs_privacy_policy()}
        </a>
        <a
          href={localizeHref("/terms")}
          className="underline underline-offset-4 hover:text-fd-primary"
        >
          {m.docs_terms_of_service()}
        </a>
      </div>
    </footer>
  );
}
