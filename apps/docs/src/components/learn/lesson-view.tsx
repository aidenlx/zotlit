// One lesson page: the cover, the strip of steps, the steps from the lesson
// body, and the end. See DESIGN.md → Learn.
//
// The page prerenders every part in order, so search engines and readers
// without JavaScript get the whole lesson. Once it runs, the URL hash picks
// the one part on screen (`#3` opens step 3, `#done` the end), and the step
// the reader is on is saved for the course page. Until the page runs, CSS
// alone shows the part the hash targets — see `preHydration`.

import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import * as m from "@/paraglide/messages.js";

import { buttonClass, labelClass, preHydration } from "./lesson-mdx";
import {
  LessonContext,
  partFromHash,
  partHash,
  saveProgress,
} from "./lesson-state";
import type { LessonStepMeta } from "./lesson-state";
import { StepPicture } from "./step-picture";

interface MapBox {
  title: string;
  items: string[];
}

export interface LessonViewData {
  slug: string;
  title: string;
  lesson: number;
  lessonCount: number;
  minutes: number;
  lede: string;
  note?: string;
  media: string;
  map: {
    zotero: MapBox;
    obsidian: MapBox;
    arrow: "to-obsidian" | "to-zotero" | "both";
    label: string;
  };
  needs: { item: string; detail: string }[];
  steps: LessonStepMeta[];
  end: { title: string; caption: string; next: string };
  /** The lesson after this one, or null after the last. */
  next: { slug: string; title: string; lesson: number } | null;
}

/** The hash a part is opened by, as a link's `hash` prop. */
const hashLinkProps = {
  to: ".",
  replace: true,
  resetScroll: true,
  hashScrollIntoView: false,
} as const;

export function LessonView({
  lesson,
  children,
}: {
  lesson: LessonViewData;
  /** The compiled lesson body: its `<Step>` parts. */
  children: ReactNode;
}) {
  const total = lesson.steps.length;
  const hash = useLocation({ select: (location) => location.hash });
  const navigate = useNavigate();
  const [at, setAt] = useState<number | null>(null);
  // The first part shown is where the reader arrived; every later one they
  // moved to, and focus follows them there.
  const arrived = useRef(false);
  const moved = useRef(false);

  // Both run before paint, so a client-side visit — which never ran the
  // inline script below — does not show every part for a frame.
  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-lesson-js", "");
  }, []);

  useLayoutEffect(() => {
    const part = partFromHash(hash, total);
    moved.current = arrived.current;
    arrived.current = true;
    setAt(part);
    // The hash names the part's element, which the browser or the router
    // scrolls to; each part starts at the top, with the strip in view.
    window.scrollTo(0, 0);
    saveProgress(lesson.slug, part, total);
  }, [hash, total, lesson.slug]);

  // Move focus to the new part's heading, so a screen reader starts there.
  useEffect(() => {
    if (at === null || !moved.current) return;
    const root = document.querySelector<HTMLElement>("[data-lesson]");
    root
      ?.querySelector<HTMLElement>("[data-part]:not([hidden]) :is(h1, h2)")
      ?.focus({ preventScroll: true });
  }, [at]);

  function go(part: number) {
    void navigate({ ...hashLinkProps, hash: partHash(part, total) });
  }

  const showsStep = at !== null && at >= 1 && at <= total;

  return (
    <LessonContext value={{ media: lesson.media, steps: lesson.steps, at, go }}>
      <script
        // Marks a running page before it paints, so `preHydration` hides
        // every part but the one the hash targets.
        dangerouslySetInnerHTML={{
          __html: `document.documentElement.setAttribute("data-lesson-js","")`,
        }}
      />
      <div
        data-lesson=""
        data-ready={at === null ? undefined : ""}
        className="mx-auto grid w-full max-w-[720px] gap-4.5 px-5 pt-5 pb-24 text-lg"
      >
        <Cover lesson={lesson} hidden={at !== null && at !== 0} />
        <nav
          aria-label={m.docs_learn_steps_label()}
          hidden={at !== null && !showsStep}
          className={cn(
            // Below 560px the names drop; each segment keeps its 44px target,
            // so the space under the bars is pulled back in.
            "grid auto-cols-fr grid-flow-col gap-1.5 max-[560px]:-mb-6",
            "[html[data-lesson-js]_[data-lesson]:not([data-ready]):not(:has([data-part=step]:target))_&]:hidden",
          )}
        >
          {lesson.steps.map((step, index) => {
            const n = index + 1;
            const now = at === n;
            return (
              <Link
                key={n}
                {...hashLinkProps}
                hash={String(n)}
                aria-current={now ? "step" : undefined}
                className="grid min-h-11 content-start gap-1.5 rounded-sm pt-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring"
              >
                <span
                  aria-hidden
                  className={cn(
                    "block h-1 rounded-[2px]",
                    now
                      ? "bg-fd-foreground"
                      : at !== null && n < at
                        ? "bg-fd-ring"
                        : "bg-fd-border",
                  )}
                />
                <span
                  className={cn(
                    "text-xs leading-tight max-[560px]:sr-only",
                    now
                      ? "font-semibold text-fd-foreground"
                      : "text-fd-muted-foreground",
                  )}
                >
                  {step.name}
                </span>
              </Link>
            );
          })}
        </nav>
        {children}
        <End lesson={lesson} hidden={at !== null && at !== total + 1} />
      </div>
    </LessonContext>
  );
}

function Cover({
  lesson,
  hidden,
}: {
  lesson: LessonViewData;
  hidden: boolean;
}) {
  return (
    <section
      data-part="cover"
      aria-labelledby="lesson-title"
      hidden={hidden}
      className="grid gap-4.5 motion-safe:animate-lesson-in [html[data-lesson-js]_[data-lesson]:not([data-ready]):has([data-part]:target)_&]:hidden"
    >
      <p className={labelClass}>
        {m.docs_learn_lesson_meta({
          number: lesson.lesson,
          total: lesson.lessonCount,
          minutes: lesson.minutes,
          steps: lesson.steps.length,
        })}
      </p>
      <h1
        id="lesson-title"
        tabIndex={-1}
        className="font-serif text-[36px] leading-[1.12] font-medium tracking-[-0.01em] text-balance outline-none"
      >
        {lesson.title}
      </h1>
      <p className="font-serif text-xl leading-snug text-fd-muted-foreground italic">
        {lesson.lede}
      </p>
      <LessonMap map={lesson.map} />
      {lesson.note && (
        <p className="text-[17px] leading-normal">{lesson.note}</p>
      )}
      <table className="w-full border-collapse text-[16.5px]">
        <thead>
          <tr>
            <th className={cn(labelClass, "pe-2.5 pb-2 text-start")}>
              {m.docs_learn_you_need()}
            </th>
            <td />
          </tr>
        </thead>
        <tbody>
          {lesson.needs.map(({ item, detail }) => (
            <tr key={item}>
              <td className="border-t border-fd-border py-2.5 pe-2.5 align-top font-semibold">
                {item}
              </td>
              <td className="border-t border-fd-border py-2.5 align-top">
                {detail}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div>
        <Link
          {...hashLinkProps}
          hash="1"
          className={cn(buttonClass.accent, "inline-flex items-center")}
        >
          {m.docs_learn_start()}
        </Link>
      </div>
      <p className={labelClass}>{m.docs_learn_keep_open()}</p>
    </section>
  );
}

const arrows = { "to-obsidian": "→", "to-zotero": "←", both: "⇄" } as const;

function LessonMap({ map }: { map: LessonViewData["map"] }) {
  const box = (label: string, { title, items }: MapBox) => (
    <div className="grid content-start gap-1.5 rounded-xl bg-fd-card p-3.5 shadow-ring">
      <span className={labelClass}>{label}</span>
      <h2 className="text-[17px] leading-tight font-semibold">{title}</h2>
      <ul className="list-disc ps-4.5 text-base text-fd-foreground/85">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
  return (
    <figure
      aria-label={m.docs_learn_map_label()}
      className="grid gap-2.5 min-[561px]:grid-cols-[1fr_auto_1fr]"
    >
      {box("Zotero", map.zotero)}
      <figcaption className="grid content-center justify-items-center gap-1 text-center text-[13px] leading-snug text-fd-muted-foreground min-[561px]:max-w-28">
        <span
          aria-hidden
          className="text-2xl leading-none text-fd-primary max-[560px]:rotate-90"
        >
          {arrows[map.arrow]}
        </span>
        {map.label}
      </figcaption>
      {box("Obsidian", map.obsidian)}
    </figure>
  );
}

function End({ lesson, hidden }: { lesson: LessonViewData; hidden: boolean }) {
  const total = lesson.steps.length;
  const last = lesson.steps[total - 1];
  const cardClass =
    "block rounded-xl bg-fd-card px-4 py-3.5 text-fd-foreground shadow-ring transition-shadow duration-150 hover:shadow-ring-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring";

  return (
    <section
      id="done"
      data-part="end"
      aria-labelledby="lesson-end-title"
      hidden={hidden}
      className={cn(
        "grid gap-4.5 motion-safe:animate-lesson-in",
        preHydration.part,
      )}
    >
      <p className={cn(labelClass, "text-check-label")}>
        {m.docs_learn_complete({ number: lesson.lesson })}
      </p>
      <h2
        id="lesson-end-title"
        tabIndex={-1}
        className="font-serif text-[34px] leading-[1.15] font-medium tracking-[-0.01em] text-balance outline-none"
      >
        {lesson.end.title}
      </h2>
      {last && (
        <StepPicture
          media={lesson.media}
          n={total}
          alt={last.alt}
          active={false}
        />
      )}
      <p className="text-[19px] leading-normal">{lesson.end.caption}</p>
      {lesson.next ? (
        <Link
          to="/learn/$lesson"
          params={{ lesson: lesson.next.slug }}
          className={cardClass}
        >
          <span className="block font-semibold">
            {m.docs_learn_next_lesson({
              number: lesson.next.lesson,
              title: lesson.next.title,
            })}
          </span>
          <span className="block text-[15px] text-fd-muted-foreground">
            {lesson.end.next}
          </span>
        </Link>
      ) : (
        <Link to="/docs/$" params={{ _splat: "how-to" }} className={cardClass}>
          <span className="block font-semibold">
            {m.docs_learn_how_to_guides()}
          </span>
          <span className="block text-[15px] text-fd-muted-foreground">
            {lesson.end.next}
          </span>
        </Link>
      )}
      <div className={preHydration.scripted}>
        <Link
          {...hashLinkProps}
          hash=""
          className={cn(buttonClass.quiet, "inline-flex items-center")}
        >
          {m.docs_learn_start_again()}
        </Link>
      </div>
    </section>
  );
}
