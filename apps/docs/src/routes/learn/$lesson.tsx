import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { use } from "react";

import { LessonView } from "@/components/learn/lesson-view";
import type { LessonViewData } from "@/components/learn/lesson-view";
import { getMDXComponents } from "@/components/mdx";
import { ReleaseSnapshotProvider } from "@/components/release-snapshot";
import { lessons } from "@/lib/collections";
import { installLessonSlugs } from "@/lib/github-releases";
import { localeInput } from "@/lib/i18n";
import { getPageLocaleState } from "@/lib/locale-state";
import { getReleaseSnapshot } from "@/lib/release-data";
import { pageHead } from "@/lib/seo";
import { appName, learnRoute, ogImageUrl } from "@/lib/shared";
import { getLessonPages, learn, lessonFurther } from "@/lib/source";
import {
  breadcrumbListSchema,
  lessonArticleSchema,
} from "@/lib/structured-data";
import * as m from "@/paraglide/messages.js";
import { getLocale } from "@/paraglide/runtime.js";

const getLesson = createServerFn({ method: "GET" })
  .validator(localeInput<{ slug: string }>())
  .handler(async ({ data: { slug, locale } }) => {
    const page = learn.getPage([slug], locale);
    if (!page) throw notFound();
    // The git date rides with the compiled body, not the frontmatter head.
    const modified = (await page.data.load()).lastModified
      ?.toISOString()
      .slice(0, 10);
    const pages = getLessonPages({ locale });
    const { data } = page;

    return {
      path: page.path,
      url: page.url,
      slugs: page.slugs,
      description: data.description,
      published: __FIRST_COMMIT_DAYS__[`learn/${page.path}`],
      modified,
      snapshot: installLessonSlugs.includes(slug)
        ? await getReleaseSnapshot()
        : null,
      view: {
        slug,
        title: data.title,
        lesson: data.lesson,
        minutes: data.minutes,
        note: data.note,
        media: data.media,
        instead: data.instead,
        needs: data.needs,
        steps: data.steps,
        end: { title: data.end.title, caption: data.end.caption },
        further: lessonFurther(data.further, locale),
        others: pages
          .filter((entry) => entry.url !== page.url)
          .map((entry) => ({
            slug: entry.slugs.join("/"),
            lesson: entry.data.lesson,
            title: entry.data.title,
            chore: entry.data.chore,
            minutes: entry.data.minutes,
            media: entry.data.media,
            result: {
              n: entry.data.steps.length,
              alt: entry.data.steps.at(-1)?.alt ?? "",
            },
          })),
      } satisfies LessonViewData,
    };
  });

function LessonBody({ path }: { path: string }) {
  const page = lessons.get(path);
  if (!page) throw notFound();
  use(page.load());
  const MDX = page.body;
  return <MDX components={getMDXComponents()} />;
}

export const Route = createFileRoute("/learn/$lesson")({
  component: Lesson,
  loader: async ({ params }) => {
    const lesson = await getLesson({
      data: { slug: params.lesson, locale: getLocale() },
    });
    await lessons.get(lesson.path)?.preload();
    return lesson;
  },
  head: ({ loaderData: lesson }) =>
    lesson === undefined
      ? {}
      : pageHead({
          title: lesson.view.title,
          description: lesson.description,
          path: lesson.url,
          card: {
            type: "learn",
            slugs: lesson.slugs,
            alt: m.docs_learn_card_alt({ title: lesson.view.title }),
          },
          schemas: [
            lessonArticleSchema({
              title: lesson.view.title,
              description: lesson.description,
              published: lesson.published,
              modified: lesson.modified,
              url: getPageLocaleState(lesson.url, getLocale()).canonicalPath,
              image: ogImageUrl("learn", lesson.slugs),
            }),
            breadcrumbListSchema([
              { name: appName, url: "/" },
              { name: m.docs_nav_learn(), url: learnRoute },
              { name: lesson.view.title, url: lesson.url },
            ]),
          ],
        }),
});

function Lesson() {
  const lesson = Route.useLoaderData();
  return (
    <LessonView key={lesson.url} lesson={lesson.view}>
      <ReleaseSnapshotProvider snapshot={lesson.snapshot}>
        <LessonBody path={lesson.path} />
      </ReleaseSnapshotProvider>
    </LessonView>
  );
}
