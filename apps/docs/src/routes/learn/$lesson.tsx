import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { use } from "react";

import { LessonView } from "@/components/learn/lesson-view";
import { getMDXComponents } from "@/components/mdx";
import { lessons } from "@/lib/collections";
import { localeInput } from "@/lib/i18n";
import { getPageLocaleState } from "@/lib/locale-state";
import { pageHead } from "@/lib/seo";
import { appName, learnRoute, ogImageUrl } from "@/lib/shared";
import { getLessonPages, learn } from "@/lib/source";
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
    const next = pages[pages.findIndex((entry) => entry.url === page.url) + 1];
    const { data } = page;

    return {
      path: page.path,
      url: page.url,
      slugs: page.slugs,
      description: data.description,
      modified,
      view: {
        slug,
        title: data.title,
        lesson: data.lesson,
        lessonCount: pages.length,
        minutes: data.minutes,
        lede: data.lede,
        note: data.note,
        media: data.media,
        map: data.map,
        needs: data.needs,
        steps: data.steps,
        end: data.end,
        next: next
          ? {
              slug: next.slugs.join("/"),
              title: next.data.title,
              lesson: next.data.lesson,
            }
          : null,
      },
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
      <LessonBody path={lesson.path} />
    </LessonView>
  );
}
