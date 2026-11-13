// One lesson page: the opener, the outcome, the checklist of steps from the
// lesson body, and the end. See DESIGN.md → Learn.
//
// The page prerenders every step open, in order, so search engines and readers
// without JavaScript get the whole lesson. Once it runs, at most one row is
// open: the row the URL hash names (`#3`), or the first one not ticked for a
// reader who began. A new reader starts with every row closed, on the
// outcome, until they press Start or open a row themselves. Ticks
// are saved per step for this browser, and the course page reads them. Until
// the page runs, CSS alone opens the row the hash targets — see `preHydration`.

import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Check } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import * as m from "@/paraglide/messages.js";

import {
  bodyClass,
  buttonClass,
  displayClass,
  focusClass,
  focusPart,
  labelClass,
  metaClass,
  titleClass,
} from "./lesson-mdx";
import {
  firstOpenStep,
  LessonContext,
  nextOpenStep,
  openOnLoad,
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

// Tailwind's `xl`, from which the lesson shows its media panel.
const wideQuery = "(min-width: 80rem)";

/** Whether the window is `xl` wide; false while the page prerenders. */
function useWide() {
  return useSyncExternalStore(
    (change) => {
      const query = window.matchMedia(wideQuery);
      query.addEventListener("change", change);
      return () => query.removeEventListener("change", change);
    },
    () => window.matchMedia(wideQuery).matches,
    () => false,
  );
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
  const wide = useWide();
  const [ready, setReady] = useState(false);
  const [ticks, setTicks] = useState<ReadonlySet<number>>(new Set());
  const [open, setOpen] = useState<number | null>(null);
  // The row the reader opened with Start, whose recording plays at once.
  const [launched, setLaunched] = useState<number | null>(null);
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
    const saved = all[lesson.slug]?.ticks ?? [];
    setProgress(all);
    setTicks(new Set(saved));
    setReady(true);
  }, [lesson.slug]);

  // The hash names the open row; with none, a reader who began finds the
  // first row not ticked open, and a new reader finds every row closed.
  useLayoutEffect(() => {
    if (!ready) return;
    if (written.current === hash) return;
    written.current = null;
    // Storage holds the latest ticks, so this effect need not run on each tick.
    const saved = readProgress()[lesson.slug]?.ticks ?? [];
    setOpen(openOnLoad(hash, saved, total));
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

  /** Opens row `n`, or closes every row, and brings `into` view: a row, or the end. */
  function show(n: number | null, into: number | null = n) {
    setOpen(n);
    setLaunched(null);
    reveal.current = into;
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
      return n;
    }
    const after = nextOpenStep(next, n, total);
    if (after === undefined) {
      setSay(m.docs_learn_say_all_done({ total }));
      show(null, total + 1);
      return total + 1;
    }
    setSay(
      m.docs_learn_say_ticked({
        number: n,
        next: after,
        title: lesson.steps[after - 1]?.title ?? "",
      }),
    );
    show(after);
    return after;
  }

  /**
   * Start, or "Continue with step N": opens the first row not ticked, exactly
   * as selecting its title does, and plays its recording at once.
   */
  function start() {
    const n = firstOpenStep(ticks, total);
    if (n === undefined) return;
    setSay(
      m.docs_learn_say_opened({
        number: n,
        title: lesson.steps[n - 1]?.title ?? "",
      }),
    );
    show(n);
    setLaunched(n);
    focusPart(n, total);
  }
  const next = ready && open === null ? firstOpenStep(ticks, total) : undefined;
  const startButton = next !== undefined && (
    <button
      type="button"
      onClick={start}
      className={cn(buttonClass, "justify-self-start")}
    >
      {m.docs_learn_start_step({
        number: next,
        begun: ticks.size > 0 ? "yes" : "no",
      })}
      <ArrowRight aria-hidden strokeWidth={2.25} className="size-4" />
    </button>
  );

  const state: LessonState = {
    media: lesson.media,
    steps: lesson.steps,
    live: ready
      ? {
          open,
          ticks,
          tick,
          toggle: (n) => show(open === n ? null : n),
          go: (n) => (n > total ? show(null, n) : show(n)),
          wide,
          launched,
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
        className="mx-auto grid w-full max-w-[720px] grid-cols-[minmax(0,1fr)] gap-12 px-5 pt-6 pb-24 [html[data-lesson-js]_&]:xl:max-w-[1400px] [html[data-lesson-js]_&]:xl:grid-cols-[minmax(0,580px)_minmax(0,1fr)]"
      >
        <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-8">
          <Opener lesson={lesson} />
          <Outcome lesson={lesson} active={ready && !wide}>
            {startButton}
          </Outcome>
          <div>
            <div
              data-lesson-bar=""
              className="sticky top-(--fd-banner-height,0px) z-10 -mx-5 flex items-center gap-3 border-b border-fd-border bg-fd-background px-5 py-3"
            >
              <span aria-hidden className="flex min-w-0 flex-1 gap-1">
                {lesson.steps.map((_, index) => {
                  const n = index + 1;
                  return (
                    <span
                      key={n}
                      className={cn(
                        "h-1.5 flex-1 rounded-full transition-colors duration-150",
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
              <p
                className={cn(
                  metaClass,
                  "shrink-0 tabular-nums",
                  allDone ? "text-check-label" : "text-fd-muted-foreground",
                )}
              >
                <span aria-hidden>
                  {count}/{total}
                </span>
                <span className="sr-only">
                  {m.docs_learn_count_done({ count, total })}
                </span>
              </p>
            </div>
            <p aria-live="polite" className="sr-only">
              {say}
            </p>
            <ol className="mt-2">{children}</ol>
          </div>
          {(!ready || allDone) && <End lesson={lesson} progress={progress} />}
        </div>
        {ready && wide && (
          <MediaPanel
            lesson={lesson}
            open={open}
            ticks={ticks}
            launched={launched}
          >
            {startButton}
          </MediaPanel>
        )}
      </div>
    </LessonContext>
  );
}

function Opener({ lesson }: { lesson: LessonViewData }) {
  return (
    <section aria-labelledby="lesson-title" className="grid gap-4">
      <div className="grid gap-2">
        <p className={cn(metaClass, "text-fd-muted-foreground")}>
          {m.docs_learn_minutes({ minutes: lesson.minutes })}
        </p>
        <h1
          id="lesson-title"
          className={cn(displayClass, "font-serif font-medium")}
        >
          {lesson.title}
        </h1>
      </div>
      <p className={cn(bodyClass, "text-pretty")}>{lesson.instead}</p>
      <div className={cn(metaClass, "grid gap-1")}>
        <p>
          <span className="text-fd-muted-foreground">
            {m.docs_learn_you_need()}{" "}
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
          <p className="text-pretty text-fd-muted-foreground">{lesson.note}</p>
        )}
      </div>
    </section>
  );
}

/**
 * Below `xl`, the result once, above the checklist: its title, the Start
 * button while no row is open, and the last step's recording at rest. From
 * `xl` a running page shows it in the panel.
 */
function Outcome({
  lesson,
  active,
  children,
}: {
  lesson: LessonViewData;
  /** The page runs without the panel, so the recording can mount. */
  active: boolean;
  /** The Start button, while no row is open. */
  children: ReactNode;
}) {
  const total = lesson.steps.length;
  const last = lesson.steps[total - 1];
  if (!last) return null;

  return (
    <section
      aria-labelledby="lesson-outcome"
      className="grid items-center gap-x-5 gap-y-3 min-[561px]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] [html[data-lesson-js]_&]:xl:hidden"
    >
      <div className="grid content-center gap-1.5">
        <p className={cn(labelClass, "text-fd-primary")}>
          {m.docs_learn_ends_with()}
        </p>
        <p
          id="lesson-outcome"
          className={cn(titleClass, "font-serif font-medium text-balance")}
        >
          {lesson.end.title}
        </p>
        {children && <div className="mt-2.5">{children}</div>}
      </div>
      <StepPicture
        media={lesson.media}
        n={total}
        alt={last.alt}
        active={active}
        autoplay={false}
      />
    </section>
  );
}

/**
 * From `xl`: the open row's recording beside the checklist, or, while no row
 * is open, the outcome at rest over the Start button. The open row's
 * recording plays at once after Start, and otherwise while it crosses the
 * middle of the window.
 */
function MediaPanel({
  lesson,
  open,
  ticks,
  launched,
  children,
}: {
  lesson: LessonViewData;
  /** The row to show, or null for the outcome. */
  open: number | null;
  ticks: ReadonlySet<number>;
  /** The row the reader opened with Start. */
  launched: number | null;
  /** The Start button, while no row is open. */
  children: ReactNode;
}) {
  const total = lesson.steps.length;
  const step = open === null ? undefined : lesson.steps[open - 1];
  const last = lesson.steps[total - 1];

  return (
    <aside
      aria-label={m.docs_learn_panel_label()}
      className="sticky top-[calc(var(--fd-banner-height,0px)+1.5rem)] grid gap-3 self-start"
    >
      {open !== null && step ? (
        <>
          <p
            className={cn(
              titleClass,
              "flex gap-2.5 font-serif font-medium text-balance",
            )}
          >
            {ticks.has(open) ? (
              <span className="shrink-0 self-center text-check-label">
                <Check aria-hidden strokeWidth={3} className="size-5" />
                <span className="sr-only">{m.docs_learn_progress_done()}</span>
              </span>
            ) : (
              <span
                aria-hidden
                className="shrink-0 font-sans font-normal text-fd-primary tabular-nums"
              >
                {open}
              </span>
            )}
            <span className="min-w-0">{step.title}</span>
          </p>
          <StepPicture
            media={lesson.media}
            n={open}
            alt={step.alt}
            active
            playNow={launched === open}
          />
        </>
      ) : (
        last && (
          <>
            <div className="grid gap-1.5">
              <p className={cn(labelClass, "text-fd-primary")}>
                {m.docs_learn_ends_with()}
              </p>
              <p
                className={cn(
                  titleClass,
                  "font-serif font-medium text-balance",
                )}
              >
                {lesson.end.title}
              </p>
            </div>
            <StepPicture
              media={lesson.media}
              n={total}
              alt={last.alt}
              active
              autoplay={false}
            />
            {children}
          </>
        )
      )}
    </aside>
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

/** Every step ticked: what ZotLit now does, and two more chores. */
function End({
  lesson,
  progress,
}: {
  lesson: LessonViewData;
  progress: Record<string, LessonProgress>;
}) {
  return (
    <section
      id="done"
      tabIndex={-1}
      aria-labelledby="lesson-end-title"
      className="grid scroll-mt-[calc(var(--fd-banner-height,0px)+5rem)] gap-5 rounded-[14px] border border-transparent bg-fd-card p-5 shadow-ring outline-none motion-safe:animate-lesson-in min-[561px]:p-7"
    >
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-check-label text-fd-background">
          <Check aria-hidden strokeWidth={3} className="size-5" />
        </span>
        <h2
          id="lesson-end-title"
          className={cn(titleClass, "min-w-0 font-semibold text-balance")}
        >
          {m.docs_learn_complete({ number: lesson.lesson })}
        </h2>
      </div>
      <p className={cn(bodyClass, "text-pretty")}>{lesson.end.caption}</p>
      <div className="grid gap-3">
        <h3 className={cn(metaClass, "font-semibold text-fd-muted-foreground")}>
          {m.docs_learn_more_chores()}
        </h3>
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
            metaClass,
            "justify-self-start rounded-sm py-1.5 font-semibold text-fd-primary underline decoration-fd-primary/40 underline-offset-4 hover:decoration-fd-primary",
            focusClass,
          )}
        >
          {m.docs_learn_all_chores()}
        </Link>
      </div>
    </section>
  );
}

/** A small link card to another lesson: its result, the chore and its minutes. */
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
      <h4 className={cn(titleClass, "font-serif font-medium text-balance")}>
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
      <p
        className={cn(
          metaClass,
          "flex flex-wrap items-center gap-x-2 text-fd-muted-foreground",
        )}
      >
        {m.docs_learn_minutes({ minutes: chore.minutes })}
        {done && <DoneBadge />}
      </p>
    </div>
  );
}

/** A check and "Done" in the check green. */
export function DoneBadge() {
  return (
    <span className="inline-flex items-center gap-1 font-semibold text-check-label">
      <Check aria-hidden strokeWidth={3} className="size-3.5" />
      {m.docs_learn_progress_done()}
    </span>
  );
}
