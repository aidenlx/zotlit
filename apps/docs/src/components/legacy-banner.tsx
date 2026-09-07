import { ArrowUpRight } from "lucide-react";

import { Banner } from "@/components/banner";
import { zotlitLegacyUrl } from "@/lib/shared";
import * as m from "@/paraglide/messages.js";

// Dismissible thin top strip: flags the v2 docs and links back to v1.
export function LegacyBanner() {
  return (
    <Banner
      id="zotlit-v2-beta"
      height="2.25rem"
      className="border-b border-fd-border/70 bg-fd-secondary py-2 text-fd-secondary-foreground"
    >
      <p className="px-7 text-[0.8125rem] leading-snug tracking-[0.005em] text-balance">
        {m.docs_legacy_banner()}{" "}
        <a
          href={zotlitLegacyUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="ms-0.5 font-medium whitespace-nowrap text-fd-primary underline decoration-fd-primary/40 underline-offset-[3px] transition-[text-decoration-color] hover:decoration-fd-primary"
        >
          {m.docs_legacy_docs_link()}
          <ArrowUpRight
            aria-hidden
            className="ms-0.5 inline size-[1.05em] shrink-0 align-[-0.14em]"
          />
        </a>
      </p>
    </Banner>
  );
}
