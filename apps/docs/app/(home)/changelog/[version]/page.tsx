import { type Metadata } from "next";
import { notFound } from "next/navigation";

import { BackCrumb } from "@/components/back-crumb";
import { JsonLd } from "@/components/json-ld";
import { getMDXComponents } from "@/components/mdx";
import { cn } from "@/lib/cn";
import { changelogProseRoles } from "@/lib/prose";
import { pageMetadata } from "@/lib/seo";
import {
  appName,
  changelogRoute,
  formatReleaseDate,
  gitConfig,
} from "@/lib/shared";
import { changelog, getChangelogPages } from "@/lib/source";
import {
  breadcrumbListSchema,
  changelogArticleSchema,
} from "@/lib/structured-data";

export const dynamicParams = false;

function isLatest(version: string): boolean {
  const [latest] = getChangelogPages();
  return latest?.data.version === version;
}

export default async function ChangelogVersionPage(
  props: PageProps<"/changelog/[version]">,
) {
  const params = await props.params;
  const page = changelog.getPage([params.version]);
  if (!page) notFound();

  const { version, date, description, companion, body: MDX } = page.data;

  const crumbs = [
    { name: appName, url: "/" },
    { name: "Changelog", url: "/changelog" },
    { name: `v${version}`, url: page.url },
  ];

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 font-serif">
      <JsonLd
        schema={changelogArticleSchema({
          title: page.data.title,
          version,
          date,
          url: page.url,
        })}
      />
      <JsonLd schema={breadcrumbListSchema(crumbs)} />
      <article className="pb-14">
        <BackCrumb href="/changelog" label="Changelog" />
        <header className="pt-4.5 pb-2">
          <h1 className="mb-2.5 flex flex-wrap items-baseline gap-4 text-4xl font-medium">
            v{version}
            {isLatest(version) && (
              <span className="border border-fd-primary px-2.5 py-0.5 font-mono text-xs tracking-[0.04em] text-fd-primary">
                latest
              </span>
            )}
          </h1>
          <p className="mb-1.5 font-mono text-xs font-medium tracking-widest text-fd-muted-foreground uppercase">
            {formatReleaseDate(date)}
          </p>
        </header>
        {companion && (
          <p className="text-[14.5px] text-fd-muted-foreground italic before:mr-1 before:text-fd-primary before:not-italic before:content-['✝']">
            Companion {companion} released alongside.
          </p>
        )}
        {description && (
          <p className="mt-3.5 mb-1.5 text-fd-muted-foreground italic">
            {description}
          </p>
        )}
        <div
          className={cn(
            changelogProseRoles,
            "mt-6 prose-h2:mt-10 prose-h2:mb-3 prose-h2:text-sm prose-h2:tracking-[0.18em] prose-h2:before:mr-2.5 prose-h2:before:h-3.5 prose-h3:mt-6 prose-h3:mb-1.5 prose-h3:text-lg prose-p:my-2 prose-ol:my-2 prose-ul:my-2 prose-li:my-1 prose-li:leading-[1.6]",
          )}
        >
          <MDX components={getMDXComponents()} />
        </div>
        <a
          href={`https://github.com/${gitConfig.user}/${gitConfig.repo}/releases/tag/${version}`}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-6.5 inline-block border border-fd-border bg-fd-card px-4.5 py-2.25 text-[15px] hover:border-fd-primary hover:text-fd-primary"
        >
          Open release on GitHub ↗
        </a>
      </article>
    </main>
  );
}

export async function generateStaticParams() {
  return changelog.generateParams().map((param) => ({
    version: param.slug[0],
  }));
}

export async function generateMetadata(
  props: PageProps<"/changelog/[version]">,
): Promise<Metadata> {
  const params = await props.params;
  const page = changelog.getPage([params.version]);
  if (!page) notFound();

  const { version, description, date } = page.data;

  return pageMetadata({
    title: `v${version}`,
    description:
      description ??
      `Changelog for ZotLit v${version} released on ${formatReleaseDate(date)}.`,
    path: page.url,
    card: {
      type: "changelog",
      ids: page.slugs,
      alt: `ZotLit v${version} release notes`,
    },
    article: { publishedTime: date.toISOString() },
    feeds: { "application/rss+xml": `${changelogRoute}/rss.xml` },
  });
}
