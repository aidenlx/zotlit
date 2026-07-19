import { ArrowLeft } from "lucide-react";
import { type Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getMDXComponents } from "@/components/mdx";
import { formatReleaseDate, gitConfig } from "@/lib/shared";
import { changelog, getChangelogPages } from "@/lib/source";

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

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6">
      <article className="pb-14">
        <p className="mt-11.5 text-[14.5px]">
          <Link
            href="/changelog"
            className="inline-flex items-center gap-1 text-fd-muted-foreground hover:text-fd-primary"
          >
            <ArrowLeft className="size-3.5" /> Changelog
          </Link>
        </p>
        <header className="pt-4.5 pb-2">
          <h1 className="mb-2.5 flex flex-wrap items-baseline gap-4 text-4xl font-medium">
            v{version}
            {isLatest(version) && (
              <span className="border border-fd-primary px-2.5 py-0.5 font-mono text-xs tracking-[0.04em] text-fd-primary">
                latest
              </span>
            )}
          </h1>
          <p className="mb-1.5 text-[15px] tracking-[0.1em] text-fd-muted-foreground [font-variant-caps:all-small-caps]">
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
        <div className="zt-prose prose max-w-none prose-sm text-fd-muted-foreground">
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

  return {
    title: `v${version}`,
    description:
      description ??
      `Changelog for ZotLit v${version} released on ${formatReleaseDate(date)}.`,
  };
}
