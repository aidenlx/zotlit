// The docs page body, shared by the `/docs` index and the `/docs/*` catch-all.
//
// The page's own body rides with the compiled MDX module rather than the
// loader payload: the table of contents carries React nodes, so it renders
// where the module is loaded instead of crossing the server boundary. The
// head, which renders before the module resolves, reads title and description
// off the loader payload instead.

import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import collections from "collections/browser";
import { getBreadcrumbItems } from "fumadocs-core/breadcrumb";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page";

import { getMDXComponents } from "@/components/mdx.tsx";
import { RedirectNotice } from "@/components/redirect-notice.tsx";
import { ReleaseSnapshotProvider } from "@/components/release-snapshot.tsx";
import { installPageSlugs } from "@/lib/github-releases.ts";
import { getReleaseSnapshot } from "@/lib/release-data.ts";
import type { ReleaseSnapshot } from "@/lib/release-data.ts";
import { pageHead } from "@/lib/seo.ts";
import { appName, docsRoute } from "@/lib/shared.ts";
import { source } from "@/lib/source.ts";
import type { Crumb } from "@/lib/structured-data.ts";
import { breadcrumbListSchema } from "@/lib/structured-data.ts";

/** Resolves a docs URL to the collection file the client loader compiles, plus what the head needs. */
export const resolveDocsPage = createServerFn({ method: "GET" })
  .validator((splat: string) => splat)
  .handler(async ({ data: splat }) => {
    const page = source.getPage(splat.split("/").filter(Boolean));
    if (!page) throw notFound();

    const trail = getBreadcrumbItems(page.url, source.pageTree, {
      includePage: true,
    }).filter(
      (crumb): crumb is Crumb =>
        typeof crumb.name === "string" && typeof crumb.url === "string",
    );

    return {
      path: page.path,
      url: page.url,
      slugs: page.slugs,
      title: page.data.title,
      description: page.data.description,
      trail,
      // Only the install pages carry request-time release facts; every other
      // docs page prerenders, so it must not depend on a GitHub lookup.
      snapshot: installPageSlugs.includes(page.slugs.join("/"))
        ? await getReleaseSnapshot()
        : null,
    };
  });

export const docsBody = collections.docs.createClientLoader<object>({
  id: "docs",
  component: ({ toc, frontmatter, default: MDX }) => (
    <DocsPage toc={toc} full={frontmatter.full}>
      <DocsTitle>{frontmatter.title}</DocsTitle>
      <DocsDescription>{frontmatter.description}</DocsDescription>
      <RedirectNotice className="mb-6" />
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

type DocsPageData = Awaited<ReturnType<typeof loadDocsPage>>;

/** Head shared by both docs routes. The docs index carries no trail of its own, so it publishes no breadcrumb. */
export function docsPageHead(page: DocsPageData | undefined) {
  if (page === undefined) return {};

  // A folder whose index resolves to the docs root (e.g. `(intro)`) yields a
  // crumb pointing at `docsRoute`, colliding with the hardcoded one below.
  const seen = new Set<string>();
  const crumbs = [
    { name: appName, url: "/" },
    { name: "Documentation", url: docsRoute },
    ...page.trail,
  ].filter((crumb) => !seen.has(crumb.url) && seen.add(crumb.url));

  return pageHead({
    title: page.title,
    description: page.description,
    path: page.url,
    card: {
      type: "docs",
      slugs: page.slugs,
      alt: `${page.title} — ZotLit documentation`,
    },
    schemas: page.trail.length > 0 ? [breadcrumbListSchema(crumbs)] : [],
  });
}

export function DocsPageView({
  path,
  snapshot,
}: {
  path: string;
  snapshot: ReleaseSnapshot | null;
}) {
  const Body = docsBody.getComponent(path);
  return (
    <ReleaseSnapshotProvider snapshot={snapshot}>
      <Body />
    </ReleaseSnapshotProvider>
  );
}
