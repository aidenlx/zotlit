// The landing's first screen: the heading, the supporting line and actions,
// then Figure 1, the research desk, with its key. The hero renders as static
// HTML; the desk's pointer states are an enhancement.
// @see apps/docs/DESIGN.md → Landing (Hero, Figure 1)

import { useState } from "react";
import type { Ref } from "react";

import { Message } from "@/components/message";
import { cn } from "@/lib/cn";
import { m } from "@/paraglide/messages.js";

import { Desk, DeskIcon } from "./desk";
import { JOBS, jobAnchor } from "./jobs";
import type { JobId } from "./jobs";
import {
  ActionLink,
  Highlighter,
  INSTALL_HREF,
  TUTORIAL_HREF,
  jumpTo,
} from "./parts";

/** The hero entrance, once: opacity, 4px blur and a 12px rise over 300 ms; opacity alone under reduced motion. */
const ENTER =
  "motion-safe:animate-landing-rise motion-reduce:animate-landing-fade";

export function Hero({
  slotRef,
  figureRef,
}: {
  /** The box the hero desk fills, measured by the scroll hand-off. */
  slotRef: Ref<HTMLDivElement>;
  figureRef: Ref<HTMLElement>;
}) {
  const [hot, setHot] = useState<JobId | null>(null);
  const pick = (id: JobId) => document.getElementById(`key-${id}`)?.click();
  return (
    <section aria-labelledby="landing-title">
      <div className="grid gap-7 pt-8 pb-10 sm:pt-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-end lg:gap-16 lg:pt-14 lg:pb-14">
        <h1
          id="landing-title"
          className={cn(
            "font-serif text-[2.6rem] leading-[1.02] font-medium tracking-[-0.015em] text-balance sm:text-[3.6rem] lg:text-[4.4rem]",
            // The largest paint: it rises without the fade, so it counts as painted at once.
            "motion-safe:animate-landing-lift",
          )}
        >
          <Message
            text={m.docs_home_title({ mark: "{mark}" })}
            slots={{
              mark: <Highlighter>{m.docs_home_title_mark()}</Highlighter>,
            }}
          />
        </h1>
        <div className="grid gap-6 lg:pb-2">
          <p
            className={cn(
              "max-w-[46ch] text-[18px] leading-relaxed text-fd-muted-foreground",
              ENTER,
              "[animation-delay:100ms]",
            )}
          >
            {m.docs_home_lede()}
          </p>
          <div
            className={cn(
              "flex flex-wrap gap-3",
              ENTER,
              "[animation-delay:200ms]",
            )}
          >
            <ActionLink href={INSTALL_HREF} primary>
              {m.docs_home_install()}
            </ActionLink>
            <ActionLink href={TUTORIAL_HREF}>
              {m.docs_home_tutorial()}
            </ActionLink>
          </div>
          <p
            className={cn(
              "text-[13.5px] leading-snug text-fd-muted-foreground",
              ENTER,
              "[animation-delay:200ms]",
            )}
          >
            {m.docs_home_requirements()}
          </p>
        </div>
      </div>
      <figure
        ref={figureRef}
        className={cn("m-0", ENTER, "[animation-delay:300ms]")}
      >
        <div ref={slotRef} className="relative">
          {/* Hidden while the moving copy or the docked desk carries it. */}
          <div className="group-data-[morph]/landing:group-data-[phase=docked]/landing:invisible group-data-[morph]/landing:group-data-[phase=moving]/landing:invisible">
            <Desk
              focus={hot}
              tag={hot}
              markers
              onPointAt={setHot}
              onPick={pick}
            />
          </div>
        </div>
        <figcaption className="mt-6 grid gap-5 lg:max-w-[calc(100%-364px)] lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-12">
          <p className="max-w-[36ch] text-[15px] leading-relaxed text-fd-muted-foreground">
            <span className="font-semibold text-fd-foreground">
              {m.docs_home_figure_label()}
            </span>{" "}
            {m.docs_home_figure_caption()}
          </p>
          <ol
            aria-label={m.docs_home_key_label()}
            className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2"
          >
            {JOBS.map((j, i) => (
              <li key={j.id}>
                <a
                  id={`key-${j.id}`}
                  href={`#${jobAnchor(j.id)}`}
                  onClick={jumpTo}
                  onPointerEnter={() => setHot(j.id)}
                  onPointerLeave={() => setHot(null)}
                  onFocus={() => setHot(j.id)}
                  onBlur={() => setHot(null)}
                  className={cn(
                    "grid min-h-11 w-full grid-cols-[2.5rem_1.5rem_minmax(0,1fr)] items-center gap-2 rounded-lg px-1.5 py-1 text-[15px] text-fd-foreground transition-colors duration-150 ease-out",
                    hot === j.id && "bg-fd-muted",
                  )}
                >
                  <DeskIcon id={j.id} className="h-7 w-10" />
                  <span
                    className={cn(
                      "font-mono text-[12px] tabular-nums",
                      hot === j.id
                        ? "text-fd-primary"
                        : "text-fd-muted-foreground",
                    )}
                  >
                    {i + 1}
                  </span>
                  <span>{j.name()}</span>
                </a>
              </li>
            ))}
          </ol>
        </figcaption>
      </figure>
    </section>
  );
}
