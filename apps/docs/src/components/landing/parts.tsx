// Small shared parts of the landing: the action buttons, the highlighter, the
// feature badges, and the in-page jump that moves focus to a job.
// @see apps/docs/DESIGN.md → Landing, Surfaces and elevation

import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";

import type { Feature } from "./jobs";

/** Where Install leads: the install page in the docs. */
export const INSTALL_HREF = "/docs/install-zotlit";
/** The guided first run. A plain path: the route belongs to another track. */
export const TUTORIAL_HREF = "/learn";

/** The landing's 44px actions: ink fill for the leading one, the raised surface for the other. */
export function ActionLink({
  href,
  primary = false,
  children,
}: {
  href: string;
  primary?: boolean;
  children: ReactNode;
}) {
  return (
    <a
      href={localizeHref(href)}
      className={cn(
        "inline-flex h-11 items-center gap-2 rounded-[10px] border border-transparent text-[15px] font-semibold transition-[background-color,box-shadow,scale] duration-150 ease-out motion-safe:active:scale-96",
        primary
          ? "bg-fd-foreground ps-[18px] pe-4 text-fd-background hover:bg-fd-foreground/85"
          : "bg-fd-card px-[18px] text-fd-foreground shadow-ring hover:shadow-ring-hover",
      )}
    >
      {children}
      {primary && (
        <ArrowRight aria-hidden className="size-4" strokeWidth={2.25} />
      )}
    </a>
  );
}

/** The highlighter: a band of Zotero yellow under the phrase, drawn so it wraps with the text. */
export function Highlighter({ children }: { children: ReactNode }) {
  return (
    <span className="bg-[linear-gradient(var(--zt-highlighter),var(--zt-highlighter))] [box-decoration-break:clone] bg-size-[100%_0.28em] bg-position-[0_88%] bg-no-repeat">
      {children}
    </span>
  );
}

function Badge({ children, tone }: { children: ReactNode; tone?: "new" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-[3px] text-[12px] leading-none font-medium whitespace-nowrap",
        tone === "new"
          ? "border-fd-ring/50 bg-fd-accent text-fd-primary"
          : "border-fd-border text-fd-muted-foreground",
      )}
    >
      {tone === "new" && (
        <span aria-hidden className="size-1.5 rounded-full bg-fd-ring" />
      )}
      {children}
    </span>
  );
}

/** The badges a feature wears: its release, and whether it is for power users or needs the Companion. */
export function Badges({ feature }: { feature: Feature }) {
  return (
    <>
      {feature.since === "2.2" && (
        <Badge tone="new">{m.docs_home_badge_new()}</Badge>
      )}
      {feature.since === "2.1" && <Badge>{m.docs_home_badge_since()}</Badge>}
      {feature.power && <Badge>{m.docs_home_badge_power()}</Badge>}
      {feature.companion && <Badge>{m.docs_home_badge_companion()}</Badge>}
    </>
  );
}

/**
 * Follows an in-page link to a job: scrolls there (smoothly unless motion is
 * reduced) and moves keyboard focus to the section. Without JavaScript the
 * link's own `#anchor` does the jump.
 */
export function jumpTo(event: React.MouseEvent<HTMLAnchorElement>) {
  const id = event.currentTarget.hash.slice(1);
  const el = document.getElementById(id);
  if (!el) return;
  event.preventDefault();
  const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
  el.focus({ preventScroll: true });
  history.replaceState(null, "", `#${id}`);
}
