import { Link, createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { ArrowRight, Check } from "lucide-react";
import { useEffect, useState } from "react";

import {
  bodyClass,
  buttonClass,
  displayClass,
  focusClass,
  metaClass,
  sectionClass,
  titleClass,
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
    <div className="mx-auto grid w-full max-w-[720px] grid-cols-[minmax(0,1fr)] gap-10 px-5 pt-8 pb-24 xl:max-w-[1180px]">
      <header className="grid max-w-[680px] gap-4">
        <h1 className={cn(displayClass, "font-serif font-medium")}>
          {m.docs_learn_heading()}
        </h1>
        <p className={cn(bodyClass, "text-pretty text-fd-muted-foreground")}>
          {m.docs_learn_lede()}
        </p>
        {allDone ? (
          <p
            className={cn(
              metaClass,
              "flex items-center gap-2 text-check-label",
            )}
          >
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
        <h2
          id="learn-chores"
          className={cn(sectionClass, "font-serif font-medium")}
        >
          {m.docs_learn_pick_chore()}
        </h2>
        {/* From `xl`, three cards over two, as in the prototype's chore grid. */}
        <ul className="grid gap-4 xl:grid-cols-6">
          {chores.map((lesson, index) => (
            <li
              key={lesson.slug}
              className={index < 3 ? "xl:col-span-2" : "xl:col-span-3"}
            >
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
        metaClass,
        "flex flex-wrap items-center gap-x-2 gap-y-1 text-fd-muted-foreground",
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
        <h2
          id="learn-start"
          className={cn(bodyClass, "min-w-0 flex-1 font-semibold text-check")}
        >
          {lesson.chore}
          <span className="sr-only"> · {m.docs_learn_progress_done()}</span>
        </h2>
        <Link
          to="/learn/$lesson"
          params={{ lesson: lesson.slug }}
          className={cn(
            metaClass,
            "rounded-sm py-1.5 font-semibold text-check underline decoration-1 underline-offset-4",
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
      <div className="grid min-w-0 gap-2 ps-1.5">
        <h2
          id="learn-start"
          className={cn(titleClass, "font-serif font-medium text-balance")}
        >
          {lesson.chore}
        </h2>
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

/** One chore: its result, the reader's words and the minutes. */
function ChoreCard({
  lesson,
  progress,
}: {
  lesson: CourseLesson;
  progress: LessonProgress | undefined;
}) {
  return (
    <div className="relative grid h-full gap-4 rounded-[14px] border border-transparent bg-fd-card p-4 shadow-ring transition-shadow duration-150 hover:shadow-ring-hover min-[561px]:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] min-[561px]:items-start min-[561px]:p-5 xl:grid-cols-1 xl:content-start">
      <div className="grid min-w-0 gap-2">
        <h3 className={cn(titleClass, "font-serif font-medium text-balance")}>
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
        <Meta lesson={lesson} progress={progress} />
      </div>
      <div className="max-[560px]:order-first xl:order-first">
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
