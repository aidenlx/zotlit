import Link from "next/link";

import { getMDXComponents } from "@/components/mdx";
import { formatReleaseDate } from "@/lib/shared";
import { getChangelogPages } from "@/lib/source";

export const metadata = {
  title: "Changelog",
  description: "Every ZotLit release, newest first.",
};

export default function ChangelogListPage() {
  const pages = getChangelogPages();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6">
      <header className="pt-14 pb-2">
        <h1 className="mb-2.5 text-4xl font-medium">Changelog</h1>
        <p className="mb-6 max-w-[60ch] text-[16.5px] text-fd-muted-foreground italic">
          Every ZotLit release, newest first. Companion releases are noted with
          the plugin version they shipped beside.
        </p>
      </header>

      <div className="pb-14">
        {pages.map((page, i) => {
          const {
            version,
            date,
            description,
            companion,
            body: MDX,
          } = page.data;
          return (
            <section
              key={page.url}
              className="grid grid-cols-1 gap-2 border-b border-fd-border/60 py-6 last:border-b-0 md:grid-cols-[190px_1fr] md:gap-6.5"
            >
              <div className="text-left md:text-right">
                <time className="mb-2 block text-[15px] tracking-[0.1em] text-fd-muted-foreground [font-variant-caps:all-small-caps]">
                  {formatReleaseDate(date)}
                </time>
                <span
                  className={`inline-block border px-2.5 py-0.5 font-mono text-xs tracking-[0.04em] text-fd-primary ${
                    i === 0 ? "border-fd-primary" : "border-fd-border"
                  }`}
                >
                  v{version}
                </span>
              </div>
              <div>
                <h2 className="mb-1 text-xl font-medium">
                  <Link
                    href={page.url as `/changelog/${string}`}
                    className="hover:text-fd-primary"
                  >
                    {description}
                  </Link>
                </h2>
                {companion && (
                  <p className="text-[14.5px] text-fd-muted-foreground italic before:mr-1 before:text-fd-primary before:not-italic before:content-['✝']">
                    Companion {companion} released alongside.
                  </p>
                )}
                <div className="mt-3 max-w-none prose-sm text-fd-muted-foreground">
                  <MDX components={getMDXComponents()} />
                </div>
              </div>
            </section>
          );
        })}
      </div>

      <footer className="flex flex-wrap justify-between gap-3 border-t border-fd-border py-6 text-sm text-fd-muted-foreground">
        <span>ZotLit · free &amp; open source</span>
        <span>Requires Zotero 9+ · Obsidian desktop</span>
      </footer>
    </main>
  );
}
