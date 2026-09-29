// The index page's lists: the recommended starting points, and the search results grouped by level.

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { EntryLevel } from "@/lib/template-directory/entry";
import type { Facet, IndexedEntry } from "@/lib/template-directory/search";
import type { FacetOption } from "@/lib/template-directory/site";
import { m } from "@/paraglide/messages.js";

import { KIND_LABEL, valueLabels } from "./labels";

type Facets = Readonly<Record<Facet, readonly FacetOption[]>>;

/** The link to an entry's page, from its `<kind folder>/<slug>` id. */
function EntryLink({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  const [kind = "", slug = ""] = id.split("/");
  return (
    <Link
      to="/templates/$kind/$slug"
      params={{ kind, slug }}
      className={className}
    >
      {children}
    </Link>
  );
}

export function StartHere({ entries }: { entries: readonly IndexedEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <section aria-labelledby="start-here" className="py-8">
      <h2
        id="start-here"
        className="mb-5 font-mono text-xs font-semibold tracking-[0.2em] text-fd-primary uppercase"
      >
        {m.docs_directory_start_here()}
      </h2>
      <ul className="grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((entry) => (
          <li key={entry.id} className="flex">
            <EntryLink
              id={entry.id}
              className="group relative flex w-full flex-col border border-fd-border bg-fd-card p-6 font-serif no-underline shadow-[6px_6px_0_0_var(--color-fd-border)] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:border-fd-primary hover:shadow-[6px_6px_0_0_var(--color-fd-primary)]"
            >
              <span
                aria-hidden
                className="absolute end-6 -top-1.75 h-9.5 w-5 bg-fd-primary [clip-path:polygon(0_0,100%_0,100%_100%,50%_74%,0_100%)]"
              />
              <span className="font-mono text-xs font-semibold tracking-[0.12em] text-fd-muted-foreground uppercase">
                {KIND_LABEL[entry.kind]()}
              </span>
              <span className="mt-1 text-[1.45rem] leading-tight font-medium text-balance">
                {entry.title}
              </span>
              <span className="mt-2.5 leading-relaxed text-fd-muted-foreground">
                {entry.summary}
              </span>
              <span className="mt-auto inline-flex items-center gap-2 pt-5 font-mono text-xs font-semibold tracking-[0.12em] text-fd-primary uppercase">
                {m.docs_directory_open_entry()}
              </span>
            </EntryLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

const GROUPS = [
  {
    level: "ready-to-use",
    heading: m.docs_directory_group_ready,
    description: m.docs_directory_group_ready_description,
  },
  {
    level: "customize",
    heading: m.docs_directory_group_customize,
    description: m.docs_directory_group_customize_description,
  },
] as const satisfies readonly {
  level: EntryLevel;
  heading: () => string;
  description: () => string;
}[];

export function ResultGroups({
  results,
  facets,
}: {
  results: readonly IndexedEntry[];
  facets: Facets;
}) {
  if (results.length === 0) {
    return (
      <p className="border-t border-fd-border py-10 font-serif text-lg text-fd-muted-foreground italic">
        {m.docs_directory_no_results()}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-10">
      {GROUPS.map(({ level, heading, description }) => {
        const entries = results.filter((entry) => entry.level === level);
        if (entries.length === 0) return null;
        return (
          <section key={level} aria-labelledby={`group-${level}`}>
            <header className="border-b border-fd-border pb-3">
              <h2
                id={`group-${level}`}
                className="font-serif text-2xl font-medium"
              >
                {heading()}
              </h2>
              <p className="mt-1 font-serif text-fd-muted-foreground italic">
                {description()}
              </p>
            </header>
            <ul>
              {entries.map((entry) => (
                <ResultRow key={entry.id} entry={entry} facets={facets} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function ResultRow({ entry, facets }: { entry: IndexedEntry; facets: Facets }) {
  const itemTypes =
    entry.itemTypes.length > 0
      ? valueLabels("itemType", facets.itemType, entry.itemTypes)
      : [m.docs_directory_any_item_type()];
  return (
    <li className="border-b border-fd-border/60 py-5 last:border-b-0">
      <p className="flex flex-wrap items-center gap-x-2 font-mono text-[0.7rem] font-medium tracking-[0.1em] text-fd-muted-foreground uppercase">
        <span>{KIND_LABEL[entry.kind]()}</span>
        {entry.recommended && (
          <span className="border border-fd-primary px-1.5 text-fd-primary">
            {m.docs_directory_recommended()}
          </span>
        )}
      </p>
      <h3 className="mt-1 font-serif text-xl leading-snug font-medium">
        <EntryLink
          id={entry.id}
          className="decoration-fd-primary underline-offset-4 hover:text-fd-primary hover:underline"
        >
          {entry.title}
        </EntryLink>
      </h3>
      <p className="mt-1 max-w-[62ch] text-pretty text-fd-muted-foreground">
        {entry.summary}
      </p>
      <p className="mt-2 text-sm text-fd-muted-foreground">
        {[
          ...valueLabels("task", facets.task, entry.tasks),
          itemTypes.join(", "),
        ].join(" · ")}
      </p>
    </li>
  );
}
