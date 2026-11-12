// One lesson page: the opener, the checklist of steps from the lesson body,
// and the end. See DESIGN.md → Learn.
//
// The page prerenders every step open, in order, so search engines and readers
// without JavaScript get the whole lesson. Once it runs, one row is open at a
// time: the row the URL hash names (`#3`), or the first one not ticked. Ticks
// are saved per step for this browser, and the course page reads them. Until
// the page runs, CSS alone opens the row the hash targets — see `preHydration`.

import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { Check, Info } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import * as m from "@/paraglide/messages.js";

import { focusClass, labelClass } from "./lesson-mdx";
import {
  firstOpenStep,
  LessonContext,
  partFromHash,
  readProgress,
  saveTicks,
} from "./lesson-state";
import type {
  LessonProgress,
  LessonStepMeta,
  LessonState,
} from "./lesson-state";
import { StepPicture } from "./step-picture";

/** Another lesson, as the end offers it. */
export interface ChoreLink {
  slug: string;
  lesson: number;
  chore: string;
  minutes: number;
  media: string;
  /** The lesson's last step, whose picture shows the result. */
  result: { n: number; alt: string };
}

export interface LessonViewData {
  slug: string;
  title: string;
  lesson: number;
  lessonCount: number;
  minutes: number;
  note?: string;
  media: string;
  today: string[];
  instead: string;
  needs: { item: string; detail: string }[];
  steps: LessonStepMeta[];
  end: { title: string; caption: string };
  /** Every other lesson, in course order. */
  others: ChoreLink[];
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function LessonView({
  lesson,
  children,
}: {
  lesson: LessonViewData;
  /** The compiled lesson body: its `<Step>` rows. */
  children: ReactNode;
}) {
  const total = lesson.steps.length;
  const hash = useLocation({ select: (location) => location.hash });
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [ticks, setTicks] = useState<ReadonlySet<number>>(new Set());
  const [open, setOpen] = useState<number | null>(null);
  const [progress, setProgress] = useState<Record<string, LessonProgress>>({});
  const [say, setSay] = useState("");
  // The hash this page wrote itself, which the hash effect leaves alone.
  const written = useRef<string | null>(null);
  // The row to bring into view after the next render.
  const reveal = useRef<number | null>(null);

  // Runs before paint, so a client-side visit — which never ran the inline
  // script below — does not show every row open for a frame.
  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-lesson-js", "");
  }, []);

  // Saved ticks live in this browser only, so they are read after mount.
  useLayoutEffect(() => {
    const all = readProgress();
    setProgress(all);
    setTicks(new Set(all[lesson.slug]?.ticks));
    setReady(true);
  }, [lesson.slug]);

  // The hash names the open row; with none, the first row not ticked opens.
  useLayoutEffect(() => {
    if (!ready) return;
    if (written.current === hash) return;
    written.current = null;
    const part = partFromHash(hash, total);
    if (part >= 1 && part <= total) setOpen(part);
    else if (part === 0) {
      // Storage holds the latest ticks, so this effect need not run on each tick.
      const saved = readProgress()[lesson.slug]?.ticks ?? [];
      setOpen(firstOpenStep(saved, total) ?? null);
    } else setOpen(null);
  }, [hash, total, ready, lesson.slug]);

  useEffect(() => {
    const n = reveal.current;
    reveal.current = null;
    if (n === null) return;
    const row = document.getElementById(n > total ? "done" : String(n));
    if (!row) return;
    const top = row.getBoundingClientRect().top;
    const bar = document.querySelector("[data-lesson-bar]");
    const covered = bar?.getBoundingClientRect().bottom ?? 0;
    if (top < covered || top > window.innerHeight * 0.6) {
      row.scrollIntoView({
        block: "start",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    }
  }, [open, total]);

  function show(n: number | null) {
    setOpen(n);
    reveal.current = n ?? total + 1;
    const next = n === null ? "" : String(n);
    written.current = next;
    void navigate({
      to: ".",
      hash: next,
      replace: true,
      resetScroll: false,
      hashScrollIntoView: false,
    });
  }

  function tick(n: number, done: boolean) {
    const next = new Set(ticks);
    if (done) next.add(n);
    else next.delete(n);
    setTicks(next);
    saveTicks(lesson.slug, next, total);
    if (!done) {
      setSay(m.docs_learn_say_unticked({ number: n }));
      show(n);
      return;
    }
    const after =
      lesson.steps.findIndex((_, i) => i + 1 > n && !next.has(i + 1)) + 1 ||
      firstOpenStep(next, total);
    if (after === undefined) {
      setSay(m.docs_learn_say_all_done({ total }));
      show(null);
      return;
    }
    setSay(
      m.docs_learn_say_ticked({
        number: n,
        next: after,
        title: lesson.steps[after - 1]?.title ?? "",
      }),
    );
    show(after);
  }

  const state: LessonState = {
    media: lesson.media,
    steps: lesson.steps,
    live: ready
      ? {
          open,
          ticks,
          tick,
          toggle: (n) => show(open === n ? null : n),
        }
      : null,
  };
  const count = ticks.size;
  const allDone = ready && count >= total;

  return (
    <LessonContext value={state}>
      <script
        // Marks a running page before it paints, so `preHydration` closes
        // every row but the one the hash targets.
        dangerouslySetInnerHTML={{
          __html: `document.documentElement.setAttribute("data-lesson-js","")`,
        }}
      />
      <div
        data-lesson=""
        data-ready={ready ? "" : undefined}
        className="mx-auto grid w-full max-w-[720px] grid-cols-[minmax(0,1fr)] gap-8 px-5 pt-6 pb-24"
      >
        <Opener lesson={lesson} ready={ready} />
        <div>
          <div
            data-lesson-bar=""
            className="sticky top-(--fd-banner-height,0px) z-10 -mx-5 flex items-center gap-4 border-b border-fd-border bg-fd-background px-5 py-3"
          >
            {/* The H1 again, for a reader scrolled down the checklist. */}
            <p
              aria-hidden
              className="min-w-0 flex-1 truncate font-serif text-base font-medium"
            >
              {lesson.title}
            </p>
            <div className="grid shrink-0 justify-items-end gap-1.5">
              <p
                className={cn(
                  labelClass,
                  "tabular-nums",
                  allDone ? "text-check-label" : "text-fd-foreground",
                )}
              >
                {m.docs_learn_count_done({ count, total })}
              </p>
              <span aria-hidden className="flex gap-0.5">
                {lesson.steps.map((_, index) => {
                  const n = index + 1;
                  return (
                    <span
                      key={n}
                      className={cn(
                        "h-1.5 w-3 rounded-full transition-colors duration-150",
                        ticks.has(n)
                          ? "bg-check-label"
                          : ready && open === n
                            ? "bg-fd-foreground"
                            : "bg-fd-border",
                      )}
                    />
                  );
                })}
              </span>
            </div>
          </div>
          <p aria-live="polite" className="sr-only">
            {say}
          </p>
          <ol className="mt-2">{children}</ol>
        </div>
        <End
          lesson={lesson}
          done={!ready || allDone}
          left={total - count}
          progress={progress}
        />
      </div>
    </LessonContext>
  );
}

function Opener({ lesson, ready }: { lesson: LessonViewData; ready: boolean }) {
  const total = lesson.steps.length;
  const last = lesson.steps[total - 1];

  return (
    <section aria-labelledby="lesson-title" className="grid gap-5">
      <div className="grid gap-3">
        <p className={labelClass}>
          {m.docs_learn_lesson_meta({
            number: lesson.lesson,
            total: lesson.lessonCount,
            minutes: lesson.minutes,
            steps: total,
          })}
        </p>
        <h1
          id="lesson-title"
          className="font-serif text-[34px] leading-[1.12] font-medium tracking-[-0.01em] text-balance min-[561px]:text-[38px]"
        >
          {lesson.title}
        </h1>
      </div>
      <div className="grid overflow-hidden rounded-[14px] border border-transparent shadow-ring min-[561px]:grid-cols-2">
        <section
          aria-labelledby="lesson-today"
          className="grid content-start gap-3 bg-fd-muted p-4 min-[561px]:p-5"
        >
          <h2
            id="lesson-today"
            className="font-serif text-xl leading-tight font-medium text-fd-muted-foreground"
          >
            {m.docs_learn_today_heading()}
          </h2>
          <ul className="grid gap-2 text-base leading-snug text-fd-muted-foreground">
            {lesson.today.map((chore) => (
              <li key={chore} className="flex gap-2.5">
                <span
                  aria-hidden
                  className="mt-[0.55em] size-1.5 shrink-0 rounded-full bg-fd-muted-foreground/60"
                />
                <span className="first-letter:uppercase">{chore}</span>
              </li>
            ))}
          </ul>
        </section>
        <section
          aria-labelledby="lesson-instead"
          className="grid content-start gap-3 border-t border-fd-border bg-fd-card p-4 min-[561px]:border-s min-[561px]:border-t-0 min-[561px]:p-5"
        >
          <h2
            id="lesson-instead"
            className="font-serif text-xl leading-tight font-medium"
          >
            {m.docs_learn_instead_heading()}
          </h2>
          <p className="text-lg leading-normal">{lesson.instead}</p>
        </section>
      </div>
      {last && (
        <figure className="grid gap-2.5">
          <StepPicture
            media={lesson.media}
            n={total}
            alt={last.alt}
            active={ready}
          />
          <figcaption className="text-base leading-normal">
            <span className={cn(labelClass, "me-2 text-fd-primary")}>
              {m.docs_learn_ends_with()}
            </span>
            {lesson.end.title}
          </figcaption>
        </figure>
      )}
      <p className="text-base leading-normal">
        <span className={cn(labelClass, "me-2")}>
          {m.docs_learn_you_need()}
        </span>
        {lesson.needs.map(({ item, detail }, index) => (
          <span key={item}>
            {index > 0 && (
              <span aria-hidden className="text-fd-muted-foreground">
                {" · "}
              </span>
            )}
            <span className="font-semibold">{item}</span>{" "}
            <span className="text-fd-muted-foreground">({detail})</span>
          </span>
        ))}
      </p>
      {lesson.note && (
        <p className="flex gap-2.5 text-base leading-normal text-fd-muted-foreground">
          <Info
            aria-hidden
            strokeWidth={1.5}
            className="mt-1 size-4 shrink-0"
          />
          <span>{lesson.note}</span>
        </p>
      )}
    </section>
  );
}

/**
 * Two other chores: lesson 1 first while it is not done, then the lessons
 * after this one not done yet, then any others.
 */
function nextChores(
  lesson: LessonViewData,
  progress: Record<string, LessonProgress>,
) {
  const isDone = (other: ChoreLink) => progress[other.slug]?.done ?? false;
  const after = [
    ...lesson.others.filter((other) => other.lesson > lesson.lesson),
    ...lesson.others.filter((other) => other.lesson < lesson.lesson),
  ];
  const first = after.find((other) => other.lesson === 1 && !isDone(other));
  const open = after.filter((other) => other !== first && !isDone(other));
  const done = after.filter((other) => other !== first && isDone(other));
  return [...(first ? [first] : []), ...open, ...done].slice(0, 2);
}

function End({
  lesson,
  done,
  left,
  progress,
}: {
  lesson: LessonViewData;
  /** Every step is ticked, or the page renders without JavaScript. */
  done: boolean;
  left: number;
  progress: Record<string, LessonProgress>;
}) {
  const total = lesson.steps.length;

  if (!done) {
    return (
      <section
        id="done"
        aria-labelledby="lesson-end-title"
        className="scroll-mt-[calc(var(--fd-banner-height,0px)+5rem)] rounded-[14px] px-5 py-4 shadow-[inset_0_0_0_1px_var(--color-fd-border)]"
      >
        <h2 id="lesson-end-title" className="text-base font-semibold">
          {m.docs_learn_steps_left({ left, total })}
        </h2>
        <p className="mt-1 text-base leading-normal text-fd-muted-foreground">
          {m.docs_learn_tick_hint()}
        </p>
      </section>
    );
  }

  return (
    <section
      id="done"
      aria-labelledby="lesson-end-title"
      className="grid scroll-mt-[calc(var(--fd-banner-height,0px)+5rem)] gap-5 rounded-[14px] border border-transparent bg-fd-card p-5 shadow-ring motion-safe:animate-lesson-in min-[561px]:p-7"
    >
      <div className="flex items-center gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-check-label text-fd-background">
          <Check aria-hidden strokeWidth={3} className="size-6" />
        </span>
        <div className="min-w-0">
          <p className={cn(labelClass, "text-check-label")}>
            {m.docs_learn_complete({ number: lesson.lesson })}
          </p>
          <h2
            id="lesson-end-title"
            className="mt-1 font-serif text-[30px] leading-tight font-medium"
          >
            {m.docs_learn_all_done({ total })}
          </h2>
        </div>
      </div>
      <p className="text-lg leading-normal">{lesson.end.caption}</p>
      <div className="grid gap-3">
        <h3 className={labelClass}>{m.docs_learn_more_chores()}</h3>
        <ul className="grid gap-3 min-[561px]:grid-cols-2">
          {nextChores(lesson, progress).map((other) => (
            <li key={other.slug}>
              <ChoreCard chore={other} done={progress[other.slug]?.done} />
            </li>
          ))}
        </ul>
        <Link
          to="/learn"
          className={cn(
            "justify-self-start rounded-sm py-1.5 text-base font-semibold text-fd-primary underline decoration-fd-primary/40 underline-offset-4 hover:decoration-fd-primary",
            focusClass,
          )}
        >
          {m.docs_learn_all_chores()}
        </Link>
      </div>
    </section>
  );
}

/** A small link card to another lesson: its result, minutes and chore. */
function ChoreCard({ chore, done }: { chore: ChoreLink; done?: boolean }) {
  return (
    <div className="group relative grid h-full content-start gap-2.5 rounded-[12px] border border-transparent bg-fd-background p-3 shadow-ring transition-shadow duration-150 hover:shadow-ring-hover">
      <StepPicture
        media={chore.media}
        n={chore.result.n}
        alt={chore.result.alt}
        active={false}
        thumb
      />
      <p className={cn(labelClass, "flex flex-wrap items-center gap-2")}>
        {m.docs_learn_minutes({ minutes: chore.minutes })}
        {done && <DoneBadge />}
      </p>
      <h4 className="font-serif text-lg leading-snug font-medium text-balance">
        <Link
          to="/learn/$lesson"
          params={{ lesson: chore.slug }}
          className={cn(
            "rounded-sm after:absolute after:inset-0 after:rounded-[12px] after:content-['']",
            focusClass,
          )}
        >
          {m.docs_learn_chore_quote({ chore: chore.chore })}
        </Link>
      </h4>
    </div>
  );
}

/** A check and "Done", on the check tint. */
export function DoneBadge() {
  return (
    <span
      className={cn(
        labelClass,
        "inline-flex items-center gap-1 rounded-full bg-check-bg px-2 py-0.5 text-check",
      )}
    >
      <Check aria-hidden strokeWidth={3} className="size-3" />
      {m.docs_learn_progress_done()}
    </span>
  );
}
