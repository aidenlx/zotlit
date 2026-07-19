import { Banner } from "fumadocs-ui/components/banner";

import { zotlitLegacyUrl } from "@/lib/shared";

// Dismissible thin top strip: flags the v2 beta docs and links back to v1.
export function LegacyBanner() {
  return (
    <Banner
      id="zotlit-v2-beta"
      height="2.25rem"
      className="border-b border-fd-border/70 bg-fd-secondary text-fd-secondary-foreground"
    >
      <p className="text-[0.8125rem] leading-none tracking-[0.005em]">
        You’re reading the ZotLit v2 beta docs. Still on v1?{" "}
        <a
          href={zotlitLegacyUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="ms-0.5 font-medium text-fd-primary underline decoration-fd-primary/40 underline-offset-[3px] transition-[text-decoration-color] hover:decoration-fd-primary"
        >
          Read the v1 docs
          <span aria-hidden className="ms-0.5">
            ↗
          </span>
        </a>
      </p>
    </Banner>
  );
}
