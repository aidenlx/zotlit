import { Link, createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

import { RepoDatum } from "@/components/repo-datum.tsx";
import { SiteFooter } from "@/components/site-footer.tsx";
import { getRepoStats } from "@/lib/release-data.ts";
import { HOME_OG_ALT, pageHead } from "@/lib/seo.ts";
import { appDescription, appName } from "@/lib/shared.ts";
import {
  organizationSchema,
  softwareApplicationSchema,
  websiteSchema,
} from "@/lib/structured-data.ts";

/** Live star and download counts, fetched per request with ~1h edge caching. */
const loadRepoStats = createServerFn({ method: "GET" }).handler(() =>
  getRepoStats(),
);

export const Route = createFileRoute("/_home/")({
  component: Home,
  loader: () => loadRepoStats(),
  head: () =>
    pageHead({
      ogTitle: appName,
      description: appDescription,
      path: "/",
      card: { type: "home", alt: HOME_OG_ALT },
      schemas: [websiteSchema, organizationSchema, softwareApplicationSchema],
    }),
});

const features = [
  {
    term: "Literature notes",
    href: "/docs/tutorial/first-note",
    ref: "Tutorial →",
    description:
      "One command turns a Zotero item into a Markdown note, shaped by your template.",
  },
  {
    term: "Citations",
    href: "/docs/how-to/insert-citations",
    ref: "How-to →",
    description:
      "Type to search your library and insert citations without leaving the editor.",
  },
  {
    term: "Annotation view",
    href: "/docs/how-to/use-annotation-view",
    ref: "How-to →",
    description:
      "A sidebar of highlights and notes that follows your active Zotero reader.",
  },
  {
    term: "Note import",
    href: "/docs/how-to/import-zotero-notes",
    ref: "How-to →",
    description:
      "Bring Zotero child notes and standalone notes into your vault as Markdown.",
  },
  {
    term: "Agent-assisted templates",
    href: "/docs/install-skill",
    ref: "How-to →",
    description:
      "Describe the note you want. Your agent edits and tests its templates against your Zotero library.",
  },
];

function Home() {
  const stats = Route.useLoaderData();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 font-serif">
      <section className="grid items-center gap-13 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:py-20">
        <div>
          <p className="mb-4 font-mono text-xs font-semibold tracking-[0.2em] text-fd-primary uppercase">
            Zotero × Obsidian
          </p>
          <h1 className="mb-5 text-4xl leading-[1.16] font-medium text-balance lg:text-[44px]">
            Your Zotero library, written into your vault.
          </h1>
          <p className="mb-4 max-w-[44ch] text-lg text-fd-muted-foreground italic">
            Literature notes, citations, and annotations from Zotero in
            Obsidian.
          </p>
          <RepoDatum stats={stats} className="mb-5" />
          <div className="flex flex-wrap items-center gap-4">
            <Link
              to="/docs/$"
              params={{ _splat: "tutorial/first-note" }}
              className="bg-fd-foreground px-6 py-2.5 text-base text-fd-background transition-colors hover:bg-fd-primary hover:text-fd-primary-foreground"
            >
              Get started
            </Link>
            <Link
              to="/docs"
              className="text-fd-muted-foreground underline decoration-fd-border underline-offset-4 transition-colors hover:text-fd-primary hover:decoration-fd-primary"
            >
              Read the docs
            </Link>
          </div>
        </div>

        <div className="relative rotate-[-0.8deg] border border-fd-border bg-fd-card font-mono text-[12.5px] leading-[1.6] shadow-[6px_6px_0_0_var(--color-fd-border)]">
          <div className="absolute -top-1.75 right-6.5 h-9.5 w-5 bg-fd-primary [clip-path:polygon(0_0,100%_0,100%_100%,50%_74%,0_100%)]" />
          <div className="overflow-x-auto p-6">
            <div className="mb-3 text-[11px] tracking-[0.16em] text-fd-muted-foreground uppercase">
              @vaswani2017.md
            </div>
            <div className="text-fd-muted-foreground">
              ---
              <br />
              citekey:{" "}
              <b className="font-medium text-fd-primary">vaswani2017</b>
              <br />
              year: <b className="font-medium text-fd-primary">2017</b>
              <br />
              zotero:{" "}
              <b className="font-medium text-fd-primary">zotero://select/…</b>
              <br />
              ---
            </div>
            <h4 className="my-3 font-mono text-sm font-normal">
              # Attention Is All You Need
            </h4>
            <div className="my-2.5 border-l-2 border-fd-primary bg-fd-accent py-0.5 pl-2.5">
              &quot;The Transformer allows for significantly more
              parallelization…&quot; <span className="opacity-60">— p. 2</span>
            </div>
            <div>
              Own note: relate to [[sequence models]] and the citation graph.
            </div>
          </div>
        </div>
      </section>

      <dl className="max-w-170 border-t border-fd-border py-8">
        {features.map((feature) => (
          <div key={feature.term} className="py-3">
            <div className="flex items-baseline gap-2.5">
              <dt className="font-mono text-sm font-semibold tracking-[0.08em] whitespace-nowrap uppercase">
                {feature.term}
              </dt>
              <span className="flex-1 -translate-y-1 border-b-2 border-dotted border-fd-border" />
              <a
                href={feature.href}
                className="font-mono text-xs font-semibold tracking-[0.12em] whitespace-nowrap text-fd-primary uppercase hover:underline"
              >
                {feature.ref}
              </a>
            </div>
            <dd className="mt-1.5 max-w-[56ch] text-fd-muted-foreground">
              {feature.description}
            </dd>
          </div>
        ))}
      </dl>

      <SiteFooter />
    </main>
  );
}
