import { Link, createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";

import { buttonClass, labelClass } from "@/components/learn/lesson-mdx";
import { readProgress } from "@/components/learn/lesson-state";
import type { LessonProgress } from "@/components/learn/lesson-state";
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
      title: page.data.title,
      description: page.data.description,
      lesson: page.data.lesson,
      minutes: page.data.minutes,
      steps: page.data.steps.length,
      outcome: page.data.end.title,
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

/** Where "Continue" leads: the first lesson not done, at the step the reader left. */
function nextLesson(
  course: CourseLesson[],
  progress: Record<string, LessonProgress>,
) {
  const lesson = course.find((entry) => !progress[entry.slug]?.done);
  if (!lesson) return undefined;
  const step = progress[lesson.slug]?.step ?? 0;
  return { lesson, hash: step > 0 ? String(step) : undefined };
}

function Course() {
  const course = Route.useLoaderData();
  // Saved progress lives in this browser only, so it is read after mount;
  // the prerendered page shows the course with no progress.
  const [progress, setProgress] = useState<Record<string, LessonProgress>>({});
  useEffect(() => setProgress(readProgress()), []);

  const started = Object.keys(progress).length > 0;
  const next = nextLesson(course, progress);

  return (
    <div className="mx-auto grid w-full max-w-[720px] gap-6 px-5 pt-8 pb-24 text-lg">
      <header className="grid gap-3">
        <h1 className="font-serif text-[36px] leading-[1.12] font-medium tracking-[-0.01em] text-balance">
          {m.docs_learn_title()}
        </h1>
        <p className="font-serif text-lg text-fd-muted-foreground italic">
          {m.docs_learn_description()}
        </p>
        <div className="mt-1">
          {next ? (
            <Link
              to="/learn/$lesson"
              params={{ lesson: next.lesson.slug }}
              hash={next.hash}
              className={cn(buttonClass.accent, "inline-flex items-center")}
            >
              {started
                ? m.docs_learn_continue_course({ number: next.lesson.lesson })
                : m.docs_learn_start_course()}
            </Link>
          ) : (
            <p className="text-check-label">{m.docs_learn_course_done()}</p>
          )}
        </div>
        <p className={labelClass}>{m.docs_learn_keep_open()}</p>
      </header>

      <ol className="grid gap-3">
        {course.map((lesson) => {
          const saved = progress[lesson.slug];
          return (
            <li key={lesson.slug}>
              <Link
                to="/learn/$lesson"
                params={{ lesson: lesson.slug }}
                className="grid gap-1.5 rounded-xl bg-fd-card px-4 py-3.5 shadow-ring transition-shadow duration-150 hover:shadow-ring-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring"
              >
                <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className={labelClass}>
                    {m.docs_learn_lesson_number({ number: lesson.lesson })}
                    {" · "}
                    {m.docs_learn_course_meta({
                      minutes: lesson.minutes,
                      steps: lesson.steps,
                    })}
                  </span>
                  {saved && (
                    <span
                      className={cn(
                        labelClass,
                        saved.done ? "text-check-label" : "text-fd-primary",
                      )}
                    >
                      {saved.done
                        ? m.docs_learn_progress_done()
                        : m.docs_learn_progress_step({
                            step: saved.step,
                            total: lesson.steps,
                          })}
                    </span>
                  )}
                </span>
                <span className="font-serif text-[22px] leading-snug font-medium text-balance">
                  {lesson.title}
                </span>
                <span className="text-base text-fd-muted-foreground">
                  <span className="font-semibold text-fd-foreground">
                    {m.docs_learn_ends_with()}:
                  </span>{" "}
                  {lesson.outcome}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
