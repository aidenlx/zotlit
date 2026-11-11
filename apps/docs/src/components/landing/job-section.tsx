// One research job: its number and name, the outcome line, the lead replica
// with its caption, and "In this job", every feature of the job.
// @see apps/docs/DESIGN.md → Landing (Job sections)

import { ArrowUpRight, Info } from "lucide-react";
import { memo } from "react";

import { Message } from "@/components/message";
import { cn } from "@/lib/cn";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";

import { DeskIcon } from "./desk";
import { FEATURES, JOBS, featuresOf, jobAnchor, jobNumber } from "./jobs";
import type { Job } from "./jobs";
import { Badges } from "./parts";
import { REPLICAS } from "./replicas";

function FeatureList({ job }: { job: Job }) {
  const list = featuresOf(job.id);
  const shown = REPLICAS[job.id].shows;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 border-b border-fd-foreground/70 pb-2">
        <h3 className="font-mono text-[11px] font-medium tracking-[0.08em] text-fd-foreground uppercase">
          {m.docs_home_in_this_job()}
        </h3>
        <span className="font-mono text-[11px] tracking-[0.08em] text-fd-muted-foreground uppercase">
          {m.docs_home_feature_count({ count: String(list.length) })}
        </span>
      </div>
      <ul className="grid max-lg:md:grid-cols-2 max-lg:md:gap-x-10 xl:grid-cols-2 xl:gap-x-10">
        {list.map((f) => {
          const on = shown.includes(f.id);
          return (
            <li
              key={f.id}
              className="grid grid-cols-[12px_minmax(0,1fr)] gap-x-3 border-b border-fd-border py-3.5"
            >
              <span className="pt-[7px]" aria-hidden>
                <span
                  className={cn(
                    "block size-2.5 rounded-full",
                    on ? "bg-fd-ring" : "border border-fd-muted-foreground/60",
                  )}
                />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  <a
                    href={localizeHref(f.href)}
                    className="group inline-flex items-center gap-1 text-[16px] leading-snug font-semibold text-fd-foreground transition-colors duration-150 ease-out hover:text-fd-primary"
                  >
                    {f.name()}
                    <ArrowUpRight
                      aria-hidden
                      className="size-3.5 text-fd-muted-foreground transition-colors duration-150 ease-out group-hover:text-fd-primary"
                      strokeWidth={2.25}
                    />
                  </a>
                  <Badges feature={f} />
                  {on && (
                    <span className="sr-only">{m.docs_home_shown_sr()}</span>
                  )}
                </div>
                <p className="mt-1 text-[15px] leading-relaxed text-fd-muted-foreground">
                  {f.line()}
                </p>
                {f.plain && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-[13.5px] leading-snug text-fd-foreground">
                    <Info
                      aria-hidden
                      className="mt-[3px] size-3.5 shrink-0 text-fd-muted-foreground"
                      strokeWidth={1.5}
                    />
                    {f.plain()}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 flex items-center gap-2 text-[13px] text-fd-muted-foreground">
        <span
          aria-hidden
          className="inline-block size-2 rounded-full bg-fd-ring"
        />
        {m.docs_home_shown_legend()}
      </p>
    </div>
  );
}

/** One job section. Memoized: nothing above it changes while the page scrolls. */
export const JobSection = memo(function JobSection({
  job,
  index,
}: {
  job: Job;
  index: number;
}) {
  const replica = REPLICAS[job.id];
  const lead = FEATURES.find((f) => f.id === replica.feature)!;
  const Replica = replica.Component;
  return (
    <section
      id={jobAnchor(job.id)}
      tabIndex={-1}
      aria-labelledby={`${jobAnchor(job.id)}-title`}
      // Off-screen sections skip style and layout until they come near; the
      // browser remembers each one's size once drawn, so nothing shifts.
      className="scroll-mt-32 border-t border-fd-border pt-14 pb-20 outline-none [contain-intrinsic-size:auto_1800px] [content-visibility:auto] lg:scroll-mt-14 lg:pt-16 lg:pb-24"
    >
      <header className="max-w-[44rem]">
        <div className="flex items-center gap-3">
          <DeskIcon id={job.id} className="h-9 w-12 shrink-0 lg:hidden" />
          <p className="font-mono text-[12px] tracking-[0.04em] text-fd-muted-foreground tabular-nums">
            <Message
              text={m.docs_home_job_counter({
                number: "{number}",
                total: jobNumber(JOBS.length - 1),
              })}
              slots={{
                number: (
                  <span className="text-fd-primary">{jobNumber(index)}</span>
                ),
              }}
            />
          </p>
        </div>
        <h2
          id={`${jobAnchor(job.id)}-title`}
          className="mt-3 font-serif text-[2rem] leading-[1.08] font-medium text-balance sm:text-[2.6rem]"
        >
          {job.name()}
        </h2>
        <p className="mt-3 max-w-[52ch] text-[17.5px] leading-relaxed text-fd-muted-foreground">
          {job.outcome()}
        </p>
      </header>
      <figure className="m-0 mt-10 min-w-0">
        <Replica />
        <figcaption className="mt-3 flex flex-wrap items-center gap-2 text-[13.5px] text-fd-muted-foreground">
          <span>{m.docs_home_shown()}</span>
          <span className="font-semibold text-fd-foreground">
            {lead.name()}
          </span>
          <Badges feature={lead} />
        </figcaption>
      </figure>
      <div className="mt-12">
        <FeatureList job={job} />
      </div>
    </section>
  );
});
