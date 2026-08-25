import { Link, createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import collections from "collections/browser";

import { getMDXComponents } from "@/components/mdx.tsx";
import { pageHead } from "@/lib/seo.ts";
import {
  appName,
  changelogFeedRoute,
  changelogRoute,
  formatReleaseDate,
} from "@/lib/shared.ts";
import { getChangelogPages } from "@/lib/source.ts";
import { breadcrumbListSchema } from "@/lib/structured-data.ts";

const listReleases = createServerFn({ method: "GET" }).handler(() =>
  getChangelogPages().map((page) => ({
    path: page.path,
    version: page.data.version,
    description: page.data.description,
    companion: page.data.companion,
    date: page.data.date,
  })),
);

const releaseBody = collections.changelogs.createClientLoader<object>({
  id: "changelogs",
  component: ({ default: MDX }) => <MDX components={getMDXComponents()} />,
});

const crumbs = [
  { name: appName, url: "/" },
  { name: "Changelog", url: changelogRoute },
];

export const Route = createFileRoute("/_home/changelog/")({
  component: ChangelogIndex,
  head: () =>
    pageHead({
      title: "Changelog",
      description: "Every ZotLit release, newest first.",
      path: changelogRoute,
      card: { type: "changelog", alt: "ZotLit Changelog" },
      feeds: { "application/rss+xml": changelogFeedRoute },
      schemas: [breadcrumbListSchema(crumbs)],
    }),
  loader: async () => {
    const releases = await listReleases();
    await Promise.all(
      releases.map((release) => releaseBody.preload(release.path)),
    );
    return releases;
  },
});

function ChangelogIndex() {
  const releases = Route.useLoaderData();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-14">
      <h1 className="mb-2 text-4xl font-medium">Changelog</h1>
      <p className="mb-10 max-w-[60ch] text-fd-muted-foreground">
        Every ZotLit release, newest first. Companion releases are noted with
        the plugin version they shipped beside.
      </p>

      {releases.map((release) => {
        const Body = releaseBody.getComponent(release.path);
        return (
          <section
            key={release.version}
            className="border-t border-fd-border py-6 last:border-b"
          >
            <time className="font-mono text-xs tracking-widest text-fd-muted-foreground uppercase">
              {formatReleaseDate(release.date)}
            </time>
            <h2 className="mt-1 text-xl font-medium">
              <Link
                to="/changelog/$version"
                params={{ version: release.version }}
              >
                v{release.version}
                {release.description && ` — ${release.description}`}
              </Link>
            </h2>
            {release.companion && (
              <p className="text-fd-muted-foreground">
                Companion {release.companion} released alongside.
              </p>
            )}
            <div className="prose mt-2">
              <Body />
            </div>
          </section>
        );
      })}
    </main>
  );
}
