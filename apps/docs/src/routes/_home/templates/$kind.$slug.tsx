import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import directory from "virtual:zotlit/template-directory";

import { BackCrumb } from "@/components/back-crumb";
import { Message } from "@/components/message";
import { SiteFooter } from "@/components/site-footer";
import { EntryActions } from "@/components/template-directory/entry-actions";
import { EntryDescription } from "@/components/template-directory/entry-description";
import { EntrySamples } from "@/components/template-directory/entry-samples";
import { EntryUse } from "@/components/template-directory/entry-use";
import {
  KIND_LABEL,
  LEVEL_LABEL,
  valueLabels,
} from "@/components/template-directory/labels";
import { cn } from "@/lib/cn";
import { ztProse } from "@/lib/prose";
import { HOME_OG_ALT, pageHead } from "@/lib/seo";
import { appName } from "@/lib/shared";
import { breadcrumbListSchema } from "@/lib/structured-data";
import { DIRECTORY_PATH, entryPath } from "@/lib/template-directory/site";
import { m } from "@/paraglide/messages.js";

const getEntry = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(({ data: id }) => {
    const entry = directory.entries.find((candidate) => candidate.id === id);
    if (!entry) throw notFound();
    const partials = entry.calls.flatMap((name) =>
      directory.entries.filter(
        (candidate) => candidate.id === `partials/${name}`,
      ),
    );
    return {
      entry,
      facets: directory.facets,
      partials: partials.map(({ id: partialId, title, summary }) => ({
        id: partialId,
        title,
        summary,
      })),
    };
  });

export const Route = createFileRoute("/_home/templates/$kind/$slug")({
  component: DirectoryEntryPage,
  loader: ({ params }) => getEntry({ data: `${params.kind}/${params.slug}` }),
  staleTime: Infinity,
  head: ({ loaderData }) => {
    if (loaderData === undefined) return {};
    const { entry } = loaderData;
    return pageHead({
      title: entry.title,
      description: entry.summary,
      path: entryPath(entry.id),
      card: { type: "home", alt: HOME_OG_ALT() },
      schemas: [
        breadcrumbListSchema([
          { name: appName, url: "/" },
          { name: m.docs_directory_title(), url: DIRECTORY_PATH },
          { name: entry.title, url: entryPath(entry.id) },
        ]),
      ],
    });
  },
});

const HEADING = "font-serif text-2xl font-medium";

function DirectoryEntryPage() {
  const { entry, facets, partials } = Route.useLoaderData();
  const itemTypes =
    entry.itemTypes.length > 0
      ? valueLabels("itemType", facets.itemType, entry.itemTypes)
      : [m.docs_directory_any_item_type()];
  const hasSamples = entry.notes.length > 0 || entry.annotations.length > 0;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6">
      <BackCrumb to="/templates" label={m.docs_directory_title()} />
      <header className="max-w-3xl pt-4.5 pb-8 font-serif">
        <p className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs font-semibold tracking-[0.14em] text-fd-primary uppercase">
          <span>{KIND_LABEL[entry.kind]()}</span>
          <span aria-hidden className="text-fd-border">
            ·
          </span>
          <span>{LEVEL_LABEL[entry.level]()}</span>
          {entry.recommended && (
            <span className="ms-1 border border-fd-primary px-1.5 font-medium tracking-[0.1em]">
              {m.docs_directory_recommended()}
            </span>
          )}
        </p>
        <h1 className="mb-3 text-4xl leading-[1.16] font-medium text-balance lg:text-[44px]">
          {entry.title}
        </h1>
        <p className="mb-4 text-lg text-pretty text-fd-muted-foreground italic">
          {entry.summary}
        </p>
        <p className="mb-6 font-mono text-xs font-medium tracking-widest text-fd-muted-foreground uppercase">
          <Message
            text={m.docs_directory_requires({ version: "{version}" })}
            slots={{
              version: (
                <span className="normal-case">{entry.minAppVersion}</span>
              ),
            }}
          />
        </p>
        <div className="font-sans">
          <EntryActions entry={entry} />
        </div>
      </header>

      <div className="grid gap-12 border-t border-fd-border pt-10 pb-14 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="flex min-w-0 flex-col gap-12">
          <dl className="grid gap-6 sm:grid-cols-2">
            <Fact term={m.docs_directory_audience()}>{entry.audience}</Fact>
            <Fact term={m.docs_directory_effort()}>{entry.effort}</Fact>
          </dl>

          <EntryDescription markdown={entry.description} />

          {hasSamples && (
            <section aria-labelledby="samples">
              <h2 id="samples" className={HEADING}>
                {m.docs_directory_samples_heading()}
              </h2>
              <p className="mt-1 mb-6 text-fd-muted-foreground">
                {m.docs_directory_samples_intro()}
              </p>
              <EntrySamples entry={entry} />
            </section>
          )}

          <section aria-labelledby="use">
            <h2 id="use" className={HEADING}>
              {m.docs_directory_use_heading()}
            </h2>
            <div className={cn("prose mt-2 max-w-none", ztProse)}>
              <EntryUse entry={entry} />
            </div>
          </section>

          {partials.length > 0 && (
            <section aria-labelledby="partials">
              <h2 id="partials" className={HEADING}>
                {m.docs_directory_calls_heading()}
              </h2>
              <p className="mt-1 mb-4 text-fd-muted-foreground">
                {entry.kind === "profile"
                  ? m.docs_directory_calls_profile()
                  : m.docs_directory_calls_recipe()}
              </p>
              <ul className="border-t border-fd-border">
                {partials.map((partial) => (
                  <li
                    key={partial.id}
                    className="border-b border-fd-border/60 py-3"
                  >
                    <Link
                      to="/templates/$kind/$slug"
                      params={{
                        kind: "partials",
                        slug: partial.id.split("/")[1] ?? "",
                      }}
                      className="font-serif text-lg font-medium decoration-fd-primary underline-offset-4 hover:text-fd-primary hover:underline"
                    >
                      {partial.title}
                    </Link>
                    <p className="text-sm text-fd-muted-foreground">
                      {partial.summary}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="flex flex-col gap-7 lg:border-s lg:border-fd-border lg:ps-8">
          <FacetList
            heading={m.docs_directory_tasks()}
            values={valueLabels("task", facets.task, entry.tasks)}
          />
          <FacetList
            heading={m.docs_directory_item_types()}
            values={itemTypes}
          />
          <FacetList
            heading={m.docs_directory_features()}
            values={valueLabels("feature", facets.feature, entry.features)}
          />
          <section>
            <h2 className={ASIDE_HEADING}>{m.docs_directory_problems()}</h2>
            <ul className="flex flex-col gap-2.5 font-serif text-[0.95rem] leading-snug italic">
              {entry.problems.map((problem) => (
                <li key={problem}>
                  <q>{problem}</q>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      <SiteFooter />
    </main>
  );
}

const ASIDE_HEADING =
  "mb-2 font-mono text-[0.72rem] font-semibold tracking-[0.1em] text-fd-primary uppercase";

function Fact({ term, children }: { term: string; children: string }) {
  return (
    <div className="border-s-2 border-fd-primary ps-4">
      <dt className="font-mono text-[0.72rem] font-semibold tracking-[0.1em] uppercase">
        {term}
      </dt>
      <dd className="mt-1.5 font-serif text-[1.05rem] leading-relaxed">
        {children}
      </dd>
    </div>
  );
}

function FacetList({
  heading,
  values,
}: {
  heading: string;
  values: readonly string[];
}) {
  if (values.length === 0) return null;
  return (
    <section>
      <h2 className={ASIDE_HEADING}>{heading}</h2>
      <ul className="flex flex-col gap-1 text-sm">
        {values.map((value) => (
          <li key={value}>{value}</li>
        ))}
      </ul>
    </section>
  );
}
