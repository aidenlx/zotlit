import { Link, createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import collections from "collections/browser";

import { CompanionNote } from "@/components/companion-note.tsx";
import { getMDXComponents } from "@/components/mdx.tsx";
import { SiteFooter } from "@/components/site-footer.tsx";
import { cn } from "@/lib/cn.ts";
import { changelogProseRoles } from "@/lib/prose.ts";
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
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 font-serif">
      <header className="pt-14 pb-2">
        <h1 className="mb-2.5 text-4xl font-medium">Changelog</h1>
        <p className="mb-6 max-w-[60ch] text-[16.5px] text-fd-muted-foreground italic">
          Every ZotLit release, newest first. Companion releases are noted with
          the plugin version they shipped beside.
        </p>
      </header>

      <div className="pb-14">
        {releases.map((release, i) => {
          const Body = releaseBody.getComponent(release.path);
          return (
            <section
              key={release.version}
              className="grid grid-cols-1 gap-2 border-b border-fd-border/60 py-6 last:border-b-0 md:grid-cols-[190px_1fr] md:gap-6.5"
            >
              <div className="text-left md:text-right">
                <time className="mb-2 block font-mono text-xs font-medium tracking-widest text-fd-muted-foreground uppercase">
                  {formatReleaseDate(release.date)}
                </time>
                <span
                  className={cn(
                    "inline-block border px-2.5 py-0.5 font-mono text-xs tracking-[0.04em] text-fd-primary",
                    i === 0 ? "border-fd-primary" : "border-fd-border",
                  )}
                >
                  v{release.version}
                </span>
              </div>
              <div>
                <h2 className="mb-1 text-xl font-medium">
                  <Link
                    to="/changelog/$version"
                    params={{ version: release.version }}
                    className="hover:text-fd-primary"
                  >
                    {release.description}
                  </Link>
                </h2>
                {release.companion && (
                  <CompanionNote version={release.companion} />
                )}
                <div
                  className={cn(
                    changelogProseRoles,
                    "mt-2.5 prose-h2:mt-6 prose-h2:mb-2.5 prose-h2:text-xs prose-h2:tracking-[0.16em] prose-h2:before:mr-2 prose-h2:before:h-3 prose-h3:mt-4 prose-h3:mb-1 prose-h3:text-base prose-p:my-1 prose-ol:my-1 prose-ul:my-1 prose-li:my-0.5 prose-li:leading-[1.55]",
                  )}
                >
                  <Body />
                </div>
              </div>
            </section>
          );
        })}
      </div>

      <SiteFooter />
    </main>
  );
}
