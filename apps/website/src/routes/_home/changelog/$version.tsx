import {
  Link,
  createFileRoute,
  notFound,
  redirect,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import collections from "collections/browser";

import { getMDXComponents } from "@/components/mdx.tsx";
import { betaFallbackUrl } from "@/lib/beta-fallback.ts";
import { pageHead } from "@/lib/seo.ts";
import {
  appName,
  changelogFeedRoute,
  changelogRoute,
  formatReleaseDate,
  repoUrl,
} from "@/lib/shared.ts";
import { changelog, getChangelogPages } from "@/lib/source.ts";
import {
  breadcrumbListSchema,
  changelogArticleSchema,
} from "@/lib/structured-data.ts";

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
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-14">
      <p>
        <Link to="/changelog" className="text-fd-muted-foreground">
          ← Changelog
        </Link>
      </p>
      <article>
        <h1 className="mt-6 mb-2 text-4xl font-medium">
          v{release.version}
          {release.latest && (
            <span className="ml-3 border border-fd-primary px-2 py-0.5 font-mono text-xs text-fd-primary">
              latest
            </span>
          )}
        </h1>
        <p className="font-mono text-xs tracking-widest text-fd-muted-foreground uppercase">
          {formatReleaseDate(release.date)}
        </p>
        {release.companion && (
          <p className="mt-2 text-fd-muted-foreground">
            Companion {release.companion} released alongside.
          </p>
        )}
        {release.description && (
          <p className="mt-2 text-fd-muted-foreground">{release.description}</p>
        )}
        <div className="prose mt-8">
          <Body />
        </div>
        <p className="mt-8">
          <a
            href={`${repoUrl}/releases/tag/${release.version}`}
            target="_blank"
            rel="noreferrer noopener"
            className="text-fd-primary"
          >
            Open release on GitHub →
          </a>
        </p>
      </article>
    </main>
  );
}
