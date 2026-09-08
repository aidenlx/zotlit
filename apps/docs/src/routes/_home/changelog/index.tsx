import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

import { CompanionNote } from "@/components/companion-note";
import { getMDXComponents } from "@/components/mdx";
import { SiteFooter } from "@/components/site-footer";
import { cn } from "@/lib/cn";
import { changelogs } from "@/lib/collections";
import { changelogProseRoles } from "@/lib/prose";
import { pageHead } from "@/lib/seo";
import {
  appName,
  changelogFeedRoute,
  changelogRoute,
  formatReleaseDate,
} from "@/lib/shared";
import { getChangelogPages } from "@/lib/source";
import { breadcrumbListSchema } from "@/lib/structured-data";
import { m } from "@/paraglide/messages.js";

const listReleases = createServerFn({ method: "GET" }).handler(() =>
  getChangelogPages().map((page) => ({
    path: page.path,
    version: page.data.version,
    description: page.data.description,
    companion: page.data.companion,
    date: page.data.date,
  })),
);

const crumbs = () => [
  { name: appName, url: "/" },
  { name: m.docs_nav_changelog(), url: changelogRoute },
];

export const Route = createFileRoute("/_home/changelog/")({
  component: ChangelogIndex,
  head: () =>
    pageHead({
      title: m.docs_nav_changelog(),
      description: m.docs_changelog_description(),
      path: changelogRoute,
      card: { type: "changelog", alt: m.docs_changelog_og_alt() },
      feeds: { "application/rss+xml": changelogFeedRoute },
      schemas: [breadcrumbListSchema(crumbs())],
    }),
  loader: async () => {
    const releases = await listReleases();
    await Promise.all(
      releases.map((release) => {
        const page = changelogs.get(release.path);
        if (!page) throw notFound();
        return page.preload();
      }),
    );
    return releases;
  },
});

function ChangelogIndex() {
  const releases = Route.useLoaderData();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 font-serif">
      <header className="pt-14 pb-2">
        <h1 className="mb-2.5 text-4xl font-medium">
          {m.docs_nav_changelog()}
        </h1>
        <p className="mb-6 max-w-[60ch] text-[16.5px] text-fd-muted-foreground italic">
          {m.docs_changelog_intro()}
        </p>
      </header>

      <div className="pb-14">
        {releases.map((release, i) => {
          const page = changelogs.get(release.path);
          if (!page) throw notFound();
          const Body = page.body;
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
                  <Body components={getMDXComponents()} />
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
