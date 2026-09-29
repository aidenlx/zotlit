import { createFileRoute, useHydrated } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Search } from "lucide-react";
import { useState } from "react";
import directory from "virtual:zotlit/template-directory";

import { SiteFooter } from "@/components/site-footer";
import {
  ResultGroups,
  StartHere,
} from "@/components/template-directory/entry-list";
import { FacetPanel } from "@/components/template-directory/facet-panel";
import { HOME_OG_ALT, pageHead } from "@/lib/seo";
import { appName } from "@/lib/shared";
import { breadcrumbListSchema } from "@/lib/structured-data";
import {
  facetCounts,
  FACETS,
  queryFromSearch,
  searchDirectory,
  searchFromQuery,
} from "@/lib/template-directory/search";
import type {
  DirectoryQuery,
  DirectorySearch,
  Facet,
} from "@/lib/template-directory/search";
import { DIRECTORY_PATH, indexedEntry } from "@/lib/template-directory/site";
import { m } from "@/paraglide/messages.js";

const getDirectoryIndex = createServerFn({ method: "GET" }).handler(() => ({
  entries: directory.entries.map(indexedEntry),
  facets: directory.facets,
}));

const EMPTY_QUERY: DirectoryQuery = { text: "", facets: {} };

export const Route = createFileRoute("/_home/templates/")({
  component: DirectoryIndex,
  validateSearch: (search: Record<string, unknown>): DirectorySearch =>
    searchFromQuery(queryFromSearch(search)),
  loader: () => getDirectoryIndex(),
  // The index is fixed at build time, so a change of query never refetches it.
  staleTime: Infinity,
  head: () =>
    pageHead({
      title: m.docs_directory_title(),
      description: m.docs_directory_description(),
      path: DIRECTORY_PATH,
      card: { type: "home", alt: HOME_OG_ALT() },
      schemas: [
        breadcrumbListSchema([
          { name: appName, url: "/" },
          { name: m.docs_directory_title(), url: DIRECTORY_PATH },
        ]),
      ],
    }),
});

function DirectoryIndex() {
  const { entries, facets } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  // The page is prerendered without a query, so the address's query applies
  // once hydration has matched that HTML.
  const hydrated = useHydrated();
  const addressed = hydrated ? queryFromSearch(search) : EMPTY_QUERY;
  // The box keeps the words as typed, spaces included; the address trims them.
  const [typed, setTyped] = useState<string | null>(null);
  const query: DirectoryQuery = {
    text: typed ?? addressed.text,
    facets: addressed.facets,
  };

  const results = searchDirectory(entries, query);
  const counts = facetCounts(
    entries,
    query,
    Object.fromEntries(
      FACETS.map((facet) => [facet, facets[facet].map(({ value }) => value)]),
    ) as Record<Facet, string[]>,
  );

  const setQuery = (next: DirectoryQuery) =>
    void navigate({ search: searchFromQuery(next), replace: true });

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6">
      <header className="max-w-3xl pt-16 pb-2 font-serif">
        <p className="mb-4 font-mono text-xs font-semibold tracking-[0.2em] text-fd-primary uppercase">
          {m.docs_directory_title()}
        </p>
        <h1 className="mb-3 text-4xl leading-[1.16] font-medium text-balance lg:text-[44px]">
          {m.docs_directory_heading()}
        </h1>
        <p className="max-w-[60ch] text-lg text-pretty text-fd-muted-foreground italic">
          {m.docs_directory_intro()}
        </p>
      </header>

      <StartHere entries={entries.filter(({ recommended }) => recommended)} />

      <div role="search" className="border-t border-fd-border pt-8">
        <label htmlFor="directory-search" className="sr-only">
          {m.docs_directory_search_label()}
        </label>
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-fd-muted-foreground"
          />
          <input
            id="directory-search"
            type="search"
            value={query.text}
            placeholder={m.docs_directory_search_placeholder()}
            onChange={(event) => {
              setTyped(event.target.value);
              setQuery({ ...query, text: event.target.value });
            }}
            className="min-h-12 w-full rounded-none border border-fd-border bg-fd-card py-2.5 pr-3 pl-11 text-base placeholder:text-fd-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring"
          />
        </div>
      </div>

      <div className="grid gap-8 pt-8 pb-14 lg:grid-cols-[15rem_1fr] lg:gap-12">
        <aside aria-label={m.docs_directory_filters()}>
          <FacetPanel
            facets={facets}
            chosen={query.facets}
            counts={counts}
            onChange={(facet, values) =>
              setQuery({
                ...query,
                facets: { ...query.facets, [facet]: values },
              })
            }
            onClear={() => setQuery({ ...query, facets: {} })}
          />
        </aside>
        <div>
          <p
            aria-live="polite"
            className="mb-6 font-mono text-xs font-medium tracking-[0.1em] text-fd-muted-foreground uppercase"
          >
            {m.docs_directory_result_count({ count: results.length })}
          </p>
          <ResultGroups results={results} facets={facets} />
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}
