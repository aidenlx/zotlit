import { getBreadcrumbItems } from "fumadocs-core/breadcrumb";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from "fumadocs-ui/layouts/docs/page";
import { createRelativeLink } from "fumadocs-ui/mdx";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DocsPageFooter } from "@/components/docs-page-footer";
import { JsonLd } from "@/components/json-ld";
import { getMDXComponents } from "@/components/mdx";
import { RedirectNotice } from "@/components/redirect-notice";
import { ztProse } from "@/lib/prose";
import { pageMetadata } from "@/lib/seo";
import { appName, docsRoute, gitConfig } from "@/lib/shared";
import { getPageMarkdownUrl, source } from "@/lib/source";
import { breadcrumbListSchema } from "@/lib/structured-data";

export default async function Page(props: PageProps<"/docs/[[...slug]]">) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const markdownUrl = getPageMarkdownUrl(page).url;

  const treeCrumbs = getBreadcrumbItems(page.url, source.pageTree, {
    includePage: true,
  }).filter(
    (c): c is { name: string; url: string } =>
      typeof c.name === "string" && typeof c.url === "string",
  );
  // A folder whose index resolves to the docs root (e.g. `(intro)`) yields a
  // crumb pointing at `docsRoute`, colliding with the hardcoded one below.
  const seen = new Set<string>();
  const crumbs = [
    { name: appName, url: "/" },
    { name: "Documentation", url: docsRoute },
    ...treeCrumbs,
  ].filter((c) => !seen.has(c.url) && seen.add(c.url));

  return (
    <DocsPage
      toc={page.data.toc}
      full={page.data.full}
      slots={{ footer: DocsPageFooter }}
    >
      {treeCrumbs.length > 0 && (
        <JsonLd schema={breadcrumbListSchema(crumbs)} />
      )}
      <RedirectNotice />
      <DocsTitle className="font-serif text-4xl leading-[1.16] font-medium text-balance">
        {page.data.title}
      </DocsTitle>
      <DocsDescription className="mb-0 font-serif text-lg italic">
        {page.data.description}
      </DocsDescription>
      <div className="flex flex-row items-center gap-2 border-b pb-6">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover
          markdownUrl={markdownUrl}
          githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/apps/docs/content/docs/${page.path}`}
        />
      </div>
      <DocsBody className={ztProse}>
        <MDX
          components={getMDXComponents({
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(
  props: PageProps<"/docs/[[...slug]]">,
): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return pageMetadata({
    title: page.data.title,
    description: page.data.description,
    path: page.url,
    card: {
      type: "docs",
      ids: page.slugs,
      alt: `${page.data.title} — ZotLit documentation`,
    },
  });
}
