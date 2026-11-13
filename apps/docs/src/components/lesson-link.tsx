// A guided lesson named in docs prose: the lesson's title as the link, then
// its length. Both come from the lesson's frontmatter, so a retitled lesson or
// a new `minutes:` shows on every page that names it.
import { asMarkdown, md } from "fumadocs-core/server";
import defaultMdxComponents from "fumadocs-ui/mdx";

import { lessons } from "@/lib/collections";
import * as m from "@/paraglide/messages.js";

/** The prose link, as a Markdown link in the page would render. */
const ProseLink = defaultMdxComponents.a;

export function LessonLink({ slug }: { slug: string }) {
  const lesson = lessons.get(`${slug}.mdx`);
  if (!lesson) throw new Error(`<LessonLink> names no lesson: ${slug}`);
  const href = `/learn/${slug}`;
  const length = m.docs_learn_link_minutes({ minutes: lesson.minutes });

  if (asMarkdown()) return md`[${lesson.title}](${href}) ${length}`;

  return (
    <>
      <ProseLink href={href}>{lesson.title}</ProseLink> {length}
    </>
  );
}
