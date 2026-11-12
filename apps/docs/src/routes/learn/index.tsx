import { Link, createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { ArrowRight, Check } from "lucide-react";
import { useEffect, useState } from "react";

import {
  buttonClass,
  focusClass,
  labelClass,
} from "@/components/learn/lesson-mdx";
import { firstOpenStep, readProgress } from "@/components/learn/lesson-state";
import type { LessonProgress } from "@/components/learn/lesson-state";
import { DoneBadge } from "@/components/learn/lesson-view";
import { StepPicture } from "@/components/learn/step-picture";
import { cn } from "@/lib/cn";
import { localeInput } from "@/lib/i18n";
import { pageHead } from "@/lib/seo";
import { appName, learnRoute } from "@/lib/shared";
import { getLessonPages } from "@/lib/source";
import { breadcrumbListSchema } from "@/lib/structured-data";
import * as m from "@/paraglide/messages.js";
import { getLocale } from "@/paraglide/runtime.js";

const getCourse = createServerFn({ method: "GET" })
  .validator(localeInput<object>())
  .handler(({ data: { locale } }) =>
    getLessonPages({ locale }).map((page) => ({
      slug: page.slugs.join("/"),
      lesson: page.data.lesson,
      chore: page.data.chore,
      today: page.data.today,
      minutes: page.data.minutes,
      media: page.data.media,
      steps: page.data.steps.length,
      resultAlt: page.data.steps.at(-1)?.alt ?? "",
    })),
  );

export const Route = createFileRoute("/learn/")({
  component: Course,
  loader: () => getCourse({ data: { locale: getLocale() } }),
  head: () =>
    pageHead({
      title: m.docs_learn_title(),
      description: m.docs_learn_description(),
      path: learnRoute,
      card: { type: "learn", alt: m.docs_learn_course_card_alt() },
      schemas: [
        breadcrumbListSchema([
          { name: appName, url: "/" },
          { name: m.docs_nav_learn(), url: learnRoute },
        ]),
      ],
    }),
});

type CourseLesson = Awaited<ReturnType<typeof getCourse>>[number];

/**
 * Where "Continue" leads: the first lesson begun and not done, at its first
 * step not ticked; or, once any lesson is done, the first lesson not done.
 */
function nextLesson(
  course: CourseLesson[],
  progress: Record<string, LessonProgress>,
) {
  if (Object.keys(progress).length === 0) return undefined;
  const begun = course.find(
    (entry) =>
      !progress[entry.slug]?.done && (progress[entry.slug]?.ticks.length ?? 0),
  );
  const lesson = begun ?? course.find((entry) => !progress[entry.slug]?.done);
  if (!lesson) return undefined;
  const step = firstOpenStep(progress[lesson.slug]?.ticks ?? [], lesson.steps);
  return { lesson, hash: begun && step ? String(step) : undefined };
}

function Course() {
  const course = Route.useLoaderData();
  // Saved progress lives in this browser only, so it is read after mount;
  // the prerendered page shows the course with no progress.
  const [progress, setProgress] = useState<Record<string, LessonProgress>>({});
  useEffect(() => setProgress(readProgress()), []);

  const [first, ...chores] = course;
  const next = nextLesson(course, progress);
  const allDone =
    course.length > 0 && course.every((entry) => progress[entry.slug]?.done);

  return (
    <div className="mx-auto grid w-full max-w-[720px] grid-cols-[minmax(0,1fr)] gap-10 px-5 pt-8 pb-24">
      <header className="grid gap-4">
        <h1 className="font-serif text-[34px] leading-[1.1] font-medium tracking-[-0.01em] text-balance min-[561px]:text-[42px]">
          {m.docs_learn_heading()}
        </h1>
        <p className="text-lg leading-relaxed text-fd-muted-foreground">
          {m.docs_learn_lede()}
        </p>
        {allDone ? (
          <p className="flex items-center gap-2 text-base text-check-label">
            <Check aria-hidden strokeWidth={2.25} className="size-4" />
            {m.docs_learn_course_done()}
          </p>
        ) : (
          next && (
            <div>
              <Link
                to="/learn/$lesson"
                params={{ lesson: next.lesson.slug }}
                hash={next.hash}
                className={buttonClass}
              >
                {m.docs_learn_continue_course({ number: next.lesson.lesson })}
                <ArrowRight aria-hidden strokeWidth={2.25} className="size-4" />
              </Link>
            </div>
          )
        )}
      </header>

      {first && <StartHere lesson={first} progress={progress[first.slug]} />}

      <section aria-labelledby="learn-chores" className="grid gap-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2
            id="learn-chores"
            className="font-serif text-[28px] leading-tight font-medium"
          >
            {m.docs_learn_pick_chore()}
          </h2>
          <p className={labelClass}>{m.docs_learn_any_order()}</p>
        </div>
        <ul className="grid gap-4">
          {chores.map((lesson) => (
            <li key={lesson.slug}>
              <ChoreCard lesson={lesson} progress={progress[lesson.slug]} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** The minutes, then "Done" or the count of steps ticked. */
function Meta({
  lesson,
  progress,
  className,
}: {
  lesson: CourseLesson;
  progress: LessonProgress | undefined;
  className?: string;
}) {
  const ticked = progress?.ticks.length ?? 0;
  return (
    <p
      className={cn(
        labelClass,
        "flex flex-wrap items-center gap-x-2 gap-y-1",
        className,
      )}
    >
      <span>{m.docs_learn_minutes({ minutes: lesson.minutes })}</span>
      {progress?.done ? (
        <DoneBadge />
      ) : (
        ticked > 0 && (
          <span className="text-fd-primary tabular-nums">
            {m.docs_learn_count_done({ count: ticked, total: lesson.steps })}
          </span>
        )
      )}
    </p>
  );
}

/** Lesson 1, which every other lesson needs: a card until it is done, then a strip. */
function StartHere({
  lesson,
  progress,
}: {
  lesson: CourseLesson;
  progress: LessonProgress | undefined;
}) {
  if (progress?.done) {
    return (
      <section
        aria-labelledby="learn-start"
        className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[14px] bg-check-bg px-4 py-3"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-check-label text-fd-background">
          <Check aria-hidden strokeWidth={3} className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn(labelClass, "text-check")}>
            {m.docs_learn_start_here()} · {m.docs_learn_progress_done()}
          </p>
          <h2
            id="learn-start"
            className="text-base leading-tight font-semibold text-check"
          >
            {lesson.chore}
          </h2>
        </div>
        <Link
          to="/learn/$lesson"
          params={{ lesson: lesson.slug }}
          className={cn(
            "rounded-sm py-1.5 text-base font-semibold text-check underline decoration-1 underline-offset-4",
            focusClass,
          )}
        >
          {m.docs_learn_open_again()}
        </Link>
      </section>
    );
  }

  const ticked = progress?.ticks.length ?? 0;
  return (
    <section
      aria-labelledby="learn-start"
      className="relative grid items-center gap-5 overflow-hidden rounded-[14px] border border-transparent bg-fd-card p-4 shadow-ring min-[561px]:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] min-[561px]:p-5"
    >
      <span aria-hidden className="absolute inset-y-0 start-0 w-1 bg-fd-ring" />
      <div className="grid min-w-0 gap-2.5 ps-1.5">
        <p className={cn(labelClass, "text-fd-primary")}>
          {m.docs_learn_start_here()}
        </p>
        <h2 className="font-serif text-2xl leading-tight font-medium text-balance">
          <span id="learn-start">{lesson.chore}</span>
        </h2>
        <p className="text-base leading-relaxed text-fd-muted-foreground">
          {m.docs_learn_start_here_line()}
        </p>
        <Meta lesson={lesson} progress={progress} />
        <div className="mt-1">
          <Link
            to="/learn/$lesson"
            params={{ lesson: lesson.slug }}
            className={buttonClass}
          >
            {ticked > 0
              ? m.docs_learn_continue_course({ number: lesson.lesson })
              : m.docs_learn_start_course()}
            <ArrowRight aria-hidden strokeWidth={2.25} className="size-4" />
          </Link>
        </div>
      </div>
      <StepPicture
        media={lesson.media}
        n={lesson.steps}
        alt={lesson.resultAlt}
        active={false}
        thumb
      />
    </section>
  );
}

/** One chore: the reader's words, what they do today, the result and the minutes. */
function ChoreCard({
  lesson,
  progress,
}: {
  lesson: CourseLesson;
  progress: LessonProgress | undefined;
}) {
  const today = new Intl.ListFormat(getLocale(), {
    type: "conjunction",
  }).format(lesson.today);

  return (
    <div className="relative grid gap-4 rounded-[14px] border border-transparent bg-fd-card p-4 shadow-ring transition-shadow duration-150 hover:shadow-ring-hover min-[561px]:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] min-[561px]:items-start min-[561px]:p-5">
      <div className="grid min-w-0 gap-2.5">
        <Meta lesson={lesson} progress={progress} />
        <h3 className="font-serif text-[22px] leading-snug font-medium text-balance">
          <Link
            to="/learn/$lesson"
            params={{ lesson: lesson.slug }}
            className={cn(
              "rounded-sm after:absolute after:inset-0 after:rounded-[14px] after:content-['']",
              focusClass,
            )}
          >
            {m.docs_learn_chore_quote({ chore: lesson.chore })}
          </Link>
        </h3>
        <p className="text-base leading-relaxed text-fd-muted-foreground">
          {m.docs_learn_today_you({ chores: today })}
        </p>
      </div>
      <div className="max-[560px]:order-first">
        <StepPicture
          media={lesson.media}
          n={lesson.steps}
          alt={lesson.resultAlt}
          active={false}
          thumb
        />
      </div>
    </div>
  );
}
