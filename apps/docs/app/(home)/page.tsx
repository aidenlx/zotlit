import Link from "next/link";

import { gitConfig } from "@/lib/shared";

const features: Array<{
  term: string;
  href: string;
  ref: string;
  description: string;
}> = [
  {
    term: "Literature notes",
    // TODO(issue-02): retarget to the literature-notes tutorial page.
    href: "/docs",
    ref: "Tutorial →",
    description:
      "One command turns a Zotero item into a Markdown note, shaped by your template.",
  },
  {
    term: "Citations",
    // TODO(issue-02): retarget to the citations how-to page.
    href: "/docs",
    ref: "How-to →",
    description:
      "Type to search your library and insert citations without leaving the editor.",
  },
  {
    term: "Annotation view",
    // TODO(issue-03): retarget to the annotation view how-to page.
    href: "/docs",
    ref: "How-to →",
    description:
      "A sidebar of highlights and notes that follows your active Zotero reader.",
  },
  {
    term: "Note import",
    // TODO(issue-03): retarget to the note import how-to page.
    href: "/docs",
    ref: "How-to →",
    description:
      "Bring Zotero child notes and standalone notes into your vault as Markdown.",
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6">
      <section className="grid items-center gap-13 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:py-20">
        <div>
          <p className="mb-4 text-sm tracking-[0.22em] text-fd-primary [font-variant-caps:all-small-caps]">
            Zotero × Obsidian
          </p>
          <h1 className="mb-5 text-4xl leading-[1.16] font-medium text-balance lg:text-[44px]">
            Your Zotero library, written into your vault.
          </h1>
          <p className="mb-8 max-w-[44ch] text-lg text-fd-muted-foreground italic">
            Integrate Zotero with Obsidian: literature notes, citations,
            annotations.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link
              // TODO(issue-02): retarget to the first tutorial page.
              href="/docs"
              className="bg-fd-foreground px-6 py-2.5 text-base text-fd-background transition-colors hover:bg-fd-primary hover:text-fd-primary-foreground"
            >
              Get started
            </Link>
            <a
              href={`https://github.com/${gitConfig.user}/${gitConfig.repo}`}
              target="_blank"
              rel="noreferrer noopener"
              className="text-fd-muted-foreground underline decoration-fd-border underline-offset-4 transition-colors hover:text-fd-primary hover:decoration-fd-primary"
            >
              View on GitHub
            </a>
          </div>
        </div>

        <div className="relative -rotate-[0.8deg] border border-fd-border bg-fd-card font-mono text-[12.5px] leading-[1.6] shadow-[6px_6px_0_0_var(--color-fd-border)]">
          <div className="absolute top-[-7px] right-[26px] h-[38px] w-5 bg-fd-primary [clip-path:polygon(0_0,100%_0,100%_100%,50%_74%,0_100%)]" />
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

      <dl className="max-w-[680px] border-t border-fd-border py-8">
        {features.map((feature) => (
          <div key={feature.term} className="py-3">
            <div className="flex items-baseline gap-2.5">
              <dt className="text-lg tracking-[0.07em] whitespace-nowrap [font-variant-caps:all-small-caps]">
                {feature.term}
              </dt>
              <span className="flex-1 -translate-y-1 border-b-2 border-dotted border-fd-border" />
              <Link
                href={feature.href}
                className="text-sm tracking-[0.1em] whitespace-nowrap text-fd-primary [font-variant-caps:all-small-caps] hover:underline"
              >
                {feature.ref}
              </Link>
            </div>
            <dd className="mt-1.5 max-w-[56ch] text-fd-muted-foreground">
              {feature.description}
            </dd>
          </div>
        ))}
      </dl>

      <footer className="flex flex-wrap justify-between gap-3 border-t border-fd-border py-6 text-sm text-fd-muted-foreground">
        <span>
          © 2022–{new Date().getFullYear()} AidenLx ·{" "}
          <a
            href={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/LICENSE`}
            target="_blank"
            rel="noreferrer noopener"
            className="underline decoration-fd-border underline-offset-4 transition-colors hover:text-fd-primary hover:decoration-fd-primary"
          >
            MIT Licensed
          </a>
        </span>
      </footer>
    </main>
  );
}
