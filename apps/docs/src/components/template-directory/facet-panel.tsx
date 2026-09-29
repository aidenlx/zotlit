// The index page's filters: one checkbox group per facet, each value with the number of entries it would show.

import { SlidersHorizontal } from "lucide-react";
import { useId, useState } from "react";

import { cn } from "@/lib/cn";
import { FACETS } from "@/lib/template-directory/search";
import type { DirectoryQuery, Facet } from "@/lib/template-directory/search";
import type { FacetOption } from "@/lib/template-directory/site";
import { m } from "@/paraglide/messages.js";

import { FACET_LABEL, optionLabel } from "./labels";

/** Facets in the order a reader narrows by them: the task first, the entry's form last. */
const PANEL_ORDER: readonly Facet[] = [
  "task",
  "itemType",
  "feature",
  "level",
  "kind",
];

export function FacetPanel({
  facets,
  chosen,
  counts,
  onChange,
  onClear,
}: {
  facets: Readonly<Record<Facet, readonly FacetOption[]>>;
  chosen: DirectoryQuery["facets"];
  counts: Record<Facet, Record<string, number>>;
  onChange: (facet: Facet, values: string[]) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const chosenCount = FACETS.reduce(
    (sum, facet) => sum + (chosen[facet]?.length ?? 0),
    0,
  );

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-10 w-full cursor-pointer items-center gap-2 border border-fd-border bg-fd-card px-3 font-mono text-xs font-semibold tracking-[0.1em] uppercase lg:hidden"
      >
        <SlidersHorizontal aria-hidden className="size-4 text-fd-primary" />
        {m.docs_directory_filters()}
        {chosenCount > 0 && (
          <span className="ms-auto rounded-sm bg-fd-primary px-1.5 text-fd-primary-foreground tabular-nums">
            {chosenCount}
          </span>
        )}
      </button>
      <div
        id={panelId}
        className={cn("mt-4 lg:mt-0 lg:block", open ? "block" : "hidden")}
      >
        <div className="mb-3 flex min-h-7 items-baseline justify-between gap-2">
          <h2 className="hidden font-mono text-xs font-semibold tracking-[0.1em] uppercase lg:block">
            {m.docs_directory_filters()}
          </h2>
          {chosenCount > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="cursor-pointer text-sm text-fd-muted-foreground underline decoration-fd-border underline-offset-4 hover:text-fd-primary hover:decoration-fd-primary"
            >
              {m.docs_directory_clear_filters()}
            </button>
          )}
        </div>
        <div className="flex flex-col gap-6">
          {PANEL_ORDER.filter((facet) => facets[facet].length > 1).map(
            (facet) => (
              <FacetGroup
                key={facet}
                facet={facet}
                options={facets[facet]}
                chosen={chosen[facet] ?? []}
                counts={counts[facet]}
                onChange={(values) => onChange(facet, values)}
              />
            ),
          )}
        </div>
      </div>
    </div>
  );
}

function FacetGroup({
  facet,
  options,
  chosen,
  counts,
  onChange,
}: {
  facet: Facet;
  options: readonly FacetOption[];
  chosen: readonly string[];
  counts: Record<string, number>;
  onChange: (values: string[]) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 font-mono text-[0.72rem] font-semibold tracking-[0.1em] text-fd-primary uppercase">
        {FACET_LABEL[facet]()}
      </legend>
      <ul className="flex flex-col">
        {options.map((option) => {
          const checked = chosen.includes(option.value);
          const count = counts[option.value] ?? 0;
          return (
            <li key={option.value}>
              <label
                className={cn(
                  "flex min-h-8 cursor-pointer items-start gap-2.5 py-1 text-sm leading-snug",
                  count === 0 && !checked && "text-fd-muted-foreground",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...chosen, option.value]
                        : chosen.filter((value) => value !== option.value),
                    )
                  }
                  className="mt-0.5 size-4 shrink-0 cursor-pointer accent-fd-primary"
                />
                <span className="min-w-0 flex-1 text-pretty">
                  {optionLabel(facet, option)}
                </span>
                <span className="font-mono text-xs text-fd-muted-foreground tabular-nums">
                  {count}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
