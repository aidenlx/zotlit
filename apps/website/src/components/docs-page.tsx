// The docs page body, shared by the `/docs` index and the `/docs/*` catch-all.
//
// The page's own metadata rides with the compiled MDX module rather than the
// loader payload: the table of contents carries React nodes, so it renders
// where the module is loaded instead of crossing the server boundary.

import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import collections from "collections/browser";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page";

import { getMDXComponents } from "@/components/mdx.tsx";
import { source } from "@/lib/source.ts";

/** Resolves a docs URL to the collection file the client loader compiles. */
export const resolveDocsPage = createServerFn({ method: "GET" })
  .validator((splat: string) => splat)
  .handler(({ data: splat }) => {
    const page = source.getPage(splat.split("/").filter(Boolean));
    if (!page) throw notFound();
    return { path: page.path };
  });

export const docsBody = collections.docs.createClientLoader<object>({
  id: "docs",
  component: ({ toc, frontmatter, default: MDX }) => (
    <DocsPage toc={toc} full={frontmatter.full}>
      <DocsTitle>{frontmatter.title}</DocsTitle>
      <DocsDescription>{frontmatter.description}</DocsDescription>
      <DocsBody>
        <MDX components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  ),
});

/** Loader shared by both docs routes: resolve the file, then compile it. */
export async function loadDocsPage(splat: string) {
  const page = await resolveDocsPage({ data: splat });
  await docsBody.preload(page.path);
  return page;
}

export function DocsPageView({ path }: { path: string }) {
  const Body = docsBody.getComponent(path);
  return <Body />;
}
