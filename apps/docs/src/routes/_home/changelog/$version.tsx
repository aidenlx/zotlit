import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import collections from "collections/browser";
import { ArrowUpRight } from "lucide-react";

import { BackCrumb } from "@/components/back-crumb";
import { CompanionNote } from "@/components/companion-note";
import { getMDXComponents } from "@/components/mdx";
import { betaFallbackUrl } from "@/lib/beta-fallback";
import { cn } from "@/lib/cn";
import { changelogProseRoles } from "@/lib/prose";
import { pageHead } from "@/lib/seo";
import {
  appName,
  changelogFeedRoute,
  changelogRoute,
  formatReleaseDate,
  repoUrl,
} from "@/lib/shared";
import { changelog, getChangelogPages } from "@/lib/source";
import {
  breadcrumbListSchema,
  changelogArticleSchema,
} from "@/lib/structured-data";

const getRelease = createServerFn({ method: "GET" })
  .validator((version: string) => version)
  .handler(({ data: version }) => {
    const page = changelog.getPage([version]);
    if (!page) {
      // A version this build never published still lives on Pre-release Docs.
      const href = betaFallbackUrl(`${changelogRoute}/${version}`);
      throw href === undefined
        ? notFound()
        : redirect({ href, statusCode: 307 });
    }
    return {
      path: page.path,
      url: page.url,
      slugs: page.slugs,
      title: page.data.title,
      version: page.data.version,
      description: page.data.description,
      companion: page.data.companion,
      date: page.data.date,
      latest: getChangelogPages()[0]?.data.version === page.data.version,
    };
  });

const releaseBody = collections.changelogs.createClientLoader<object>({
  id: "changelogs",
  component: ({ default: MDX }) => <MDX components={getMDXComponents()} />,
});

export const Route = createFileRoute("/_home/changelog/$version")({
  component: ChangelogVersion,
  loader: async ({ params }) => {
    const release = await getRelease({ data: params.version });
    await releaseBody.preload(release.path);
    return release;
  },
  head: ({ loaderData: release }) =>
    release === undefined
      ? {}
      : pageHead({
          title: `v${release.version}`,
          description:
            release.description ??
            `Changelog for ZotLit v${release.version} released on ${formatReleaseDate(release.date)}.`,
          path: release.url,
          card: {
            type: "changelog",
            slugs: release.slugs,
            alt: `ZotLit v${release.version} release notes`,
          },
          article: { publishedTime: release.date },
          feeds: { "application/rss+xml": changelogFeedRoute },
          schemas: [
            changelogArticleSchema({
              title: release.title,
              version: release.version,
              date: release.date,
              url: release.url,
            }),
            breadcrumbListSchema([
              { name: appName, url: "/" },
              { name: "Changelog", url: changelogRoute },
              { name: `v${release.version}`, url: release.url },
            ]),
          ],
        }),
});

function ChangelogVersion() {
  const release = Route.useLoaderData();
  const Body = releaseBody.getComponent(release.path);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 font-serif">
      <article className="pb-14">
        <BackCrumb to="/changelog" label="Changelog" />
        <header className="pt-4.5 pb-2">
          <h1 className="mb-2.5 flex flex-wrap items-baseline gap-4 text-4xl font-medium">
            v{release.version}
            {release.latest && (
              <span className="border border-fd-primary px-2.5 py-0.5 font-mono text-xs tracking-[0.04em] text-fd-primary">
                latest
              </span>
            )}
          </h1>
          <p className="mb-1.5 font-mono text-xs font-medium tracking-widest text-fd-muted-foreground uppercase">
            {formatReleaseDate(release.date)}
          </p>
        </header>
        {release.companion && <CompanionNote version={release.companion} />}
        {release.description && (
          <p className="mt-3.5 mb-1.5 text-fd-muted-foreground italic">
            {release.description}
          </p>
        )}
        <div
          className={cn(
            changelogProseRoles,
            "mt-6 prose-h2:mt-10 prose-h2:mb-3 prose-h2:text-sm prose-h2:tracking-[0.18em] prose-h2:before:mr-2.5 prose-h2:before:h-3.5 prose-h3:mt-6 prose-h3:mb-1.5 prose-h3:text-lg prose-p:my-2 prose-ol:my-2 prose-ul:my-2 prose-li:my-1 prose-li:leading-[1.6]",
          )}
        >
          <Body />
        </div>
        <a
          href={`${repoUrl}/releases/tag/${release.version}`}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-6.5 inline-flex items-center gap-2 border border-fd-border bg-fd-card px-4.5 py-2.25 text-[15px] hover:border-fd-primary hover:text-fd-primary"
        >
          Open release on GitHub
          <ArrowUpRight aria-hidden className="size-[1.05em] shrink-0" />
        </a>
      </article>
    </main>
  );
}
