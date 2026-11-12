// Small shared parts of the landing: the action buttons, the tutorial link,
// the highlighter, the section label, and the pause button every loop has.
// @see apps/docs/DESIGN.md → Landing, Surfaces and elevation

import { Pause, Play } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";

/** Where Install leads: the install page in the docs. */
export const INSTALL_HREF = "/docs/install-zotlit";
/** The guided first run. A plain path: the route belongs to another track. */
export const TUTORIAL_HREF = "/learn";

/** The landing's 44px actions: the accent fill for the leading one, the raised surface for the other. */
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
        "inline-flex h-11 items-center justify-center rounded-[10px] border border-transparent px-5 text-[0.9375rem] font-semibold transition-[background-color,box-shadow,scale] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary motion-safe:active:scale-96",
        primary
          ? "bg-fd-primary text-fd-primary-foreground hover:bg-fd-primary/90"
          : "bg-fd-card text-fd-foreground shadow-ring hover:shadow-ring-hover",
      )}
    >
      {children}
    </a>
  );
}

/** Install and the tutorial, side by side from 640px, stacked full-width below. */
export function Actions({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center sm:justify-center",
        className,
      )}
    >
      <ActionLink href={INSTALL_HREF} primary>
        {m.docs_home_install()}
      </ActionLink>
      <ActionLink href={TUTORIAL_HREF}>{m.docs_home_tutorial()}</ActionLink>
    </div>
  );
}

/**
 * A link to one lesson, in the accent text tone. Each link names its lesson, so
 * the page's lesson links read apart out of context.
 */
export function LessonLink({
  lesson,
  label,
}: {
  lesson: string;
  label: string;
}) {
  return (
    <a
      href={localizeHref(`${TUTORIAL_HREF}/${lesson}`)}
      className="inline-flex items-center gap-1 rounded-sm text-base font-medium text-fd-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary"
    >
      {label}
      <span aria-hidden>→</span>
    </a>
  );
}

/** A section's apparatus label: mono uppercase, muted. */
export function SectionLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "font-mono text-[0.8125rem] font-medium tracking-[0.12em] text-fd-muted-foreground uppercase",
        className,
      )}
    >
      {children}
    </p>
  );
}

/**
 * Pauses or plays a loop (WCAG 2.2.2): a 36px round button on the raised
 * surface, in a corner of the loop's frame. Hidden under reduced motion,
 * where no loop plays.
 */
export function LoopToggle({
  paused,
  onToggle,
  pauseLabel,
  playLabel,
  className,
}: {
  paused: boolean;
  onToggle: () => void;
  pauseLabel: string;
  playLabel: string;
  className?: string;
}) {
  const Icon = paused ? Play : Pause;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={paused ? playLabel : pauseLabel}
      className={cn(
        "flex size-9 items-center justify-center rounded-full border border-transparent bg-fd-card text-fd-foreground shadow-ring transition-[box-shadow] duration-150 ease-out hover:shadow-ring-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary motion-reduce:hidden",
        className,
      )}
    >
      <Icon aria-hidden className="size-4" strokeWidth={2.25} />
    </button>
  );
}

/**
 * The highlighter: a band of Zotero yellow under the phrase, drawn so it wraps
 * with the text. With motion on, it sweeps across once after the page loads.
 */
export function Highlighter({ children }: { children: ReactNode }) {
  return (
    <span className="bg-[linear-gradient(var(--zt-highlighter),var(--zt-highlighter))] [box-decoration-break:clone] bg-size-[100%_0.28em] bg-position-[0_88%] bg-no-repeat motion-safe:animate-desk-sweep">
      {children}
    </span>
  );
}
