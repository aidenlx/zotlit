// The landing's contents: from 1024px the docked desk and the eight jobs in a
// sticky column beside the sections; below it, a bar of the eight objects that
// appears once Figure 1 has scrolled away. Both mark the job in view.
// @see apps/docs/DESIGN.md → Landing (Contents column, Below 1024px)

import { ArrowRight } from "lucide-react";
import { useSyncExternalStore } from "react";

import { cn } from "@/lib/cn";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";

import { Desk, DeskIcon } from "./desk";
import { JOB_IDS, JOBS, jobAnchor, jobNumber } from "./jobs";
import type { JobId } from "./jobs";
import { INSTALL_HREF, jumpTo } from "./parts";

// ---- The job in view ----
// One store, read by the contents, the phone bar and the desks, so the job
// sections themselves never re-render while the page scrolls.

let current: JobId | null = null;
const listeners = new Set<() => void>();

/** The job whose section crosses 40% of the viewport height. */
function readCurrent(): JobId | null {
  const line = window.innerHeight * 0.4;
  for (const id of JOB_IDS) {
    const r = document.getElementById(jobAnchor(id))?.getBoundingClientRect();
    if (r && r.top <= line && r.bottom > line) return id;
  }
  return null;
}

/** Re-reads the job in view; the page's scroll handler calls it once per frame. */
export function updateCurrentJob() {
  const next = readCurrent();
  if (next === current) return;
  current = next;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useCurrentJob() {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}

// ---- From 1024px: the sticky column ----

/** The docked desk; selecting an object jumps to its job. */
export function DockedDesk() {
  const job = useCurrentJob();
  return (
    <Desk
      focus={job}
      onPick={(id) => document.getElementById(`toc-${id}`)?.click()}
    />
  );
}

/** The moving copy of the desk, from the hero to the column; the scroll handler places it. */
export function MovingDesk() {
  const job = useCurrentJob();
  return <Desk focus={job} markers morph />;
}

export function Contents() {
  const job = useCurrentJob();
  return (
    <nav aria-label={m.docs_home_contents()}>
      <p className="px-2 font-mono text-[11px] font-medium tracking-[0.08em] text-fd-muted-foreground uppercase">
        {m.docs_home_contents()}
      </p>
      <ol className="mt-2 grid gap-0.5">
        {JOBS.map((j, i) => {
          const on = job === j.id;
          return (
            <li key={j.id}>
              <a
                id={`toc-${j.id}`}
                href={`#${jobAnchor(j.id)}`}
                onClick={jumpTo}
                aria-current={on ? "location" : undefined}
                className={cn(
                  "grid grid-cols-[2rem_minmax(0,1fr)] items-baseline rounded-lg border border-transparent px-2 py-1.5 text-[14.5px] leading-snug transition-[color,background-color,box-shadow] duration-150 ease-out",
                  on
                    ? "bg-fd-card font-semibold text-fd-foreground shadow-ring"
                    : "text-fd-muted-foreground hover:bg-fd-muted hover:text-fd-foreground",
                )}
              >
                <span
                  className={cn(
                    "font-mono text-[12px] font-normal tabular-nums",
                    on && "text-fd-primary",
                  )}
                >
                  {jobNumber(i)}
                </span>
                <span>{j.name()}</span>
              </a>
            </li>
          );
        })}
      </ol>
      <a
        href={localizeHref(INSTALL_HREF)}
        className="mt-4 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[14.5px] font-semibold text-fd-foreground transition-colors duration-150 ease-out hover:bg-fd-muted"
      >
        {m.docs_home_install()}
        <ArrowRight aria-hidden className="size-[15px]" strokeWidth={2.25} />
      </a>
    </nav>
  );
}

// ---- Below 1024px: the bar of objects ----

export function PhoneBar() {
  const job = useCurrentJob();
  const name = JOBS.find((j) => j.id === job)?.name;
  return (
    <nav
      aria-label={m.docs_home_jobs_bar_label()}
      className="pointer-events-none fixed inset-x-0 top-14 z-30 border-b border-fd-border bg-fd-background/90 opacity-0 backdrop-blur-md transition-[opacity,translate] duration-150 ease-out group-data-[bar]/landing:pointer-events-auto group-data-[bar]/landing:translate-y-0 group-data-[bar]/landing:opacity-100 group-data-[bar]/landing:duration-300 motion-safe:-translate-y-3 lg:hidden"
      // `inert` follows the bar's visibility; the scroll handler sets it.
      data-landing-bar=""
      inert
    >
      <ol className="mx-auto flex max-w-[640px] px-2 pt-1.5">
        {JOBS.map((j, i) => {
          const on = job === j.id;
          return (
            <li key={j.id} className="min-w-0 flex-1">
              <a
                href={`#${jobAnchor(j.id)}`}
                onClick={jumpTo}
                aria-label={`${jobNumber(i)} ${j.name()}`}
                aria-current={on ? "location" : undefined}
                className={cn(
                  "grid justify-items-center gap-0.5 rounded-lg border border-transparent py-1 transition-[background-color,box-shadow] duration-150 ease-out",
                  on && "bg-fd-card shadow-ring",
                )}
              >
                <DeskIcon
                  id={j.id}
                  className={cn("h-6 w-8", !on && "opacity-55")}
                />
                <span
                  className={cn(
                    "font-mono text-[10px] tabular-nums",
                    on ? "text-fd-primary" : "text-fd-muted-foreground",
                  )}
                >
                  {jobNumber(i)}
                </span>
              </a>
            </li>
          );
        })}
      </ol>
      <p
        aria-hidden
        className="truncate px-4 pt-1 pb-2 text-center text-[13px] font-semibold text-fd-foreground"
      >
        {name ? name() : m.docs_home_key_label()}
      </p>
    </nav>
  );
}
