// A Profile entry's page: the ready-made note first, with one button to add it to ZotLit and the example note beside it.

import { ChevronDown } from "lucide-react";

import { BackCrumb } from "@/components/back-crumb";
import { SiteFooter } from "@/components/site-footer";
import { cn } from "@/lib/cn";
import { ztProse } from "@/lib/prose";
import type { SiteEntry } from "@/lib/template-directory/site";
import { m } from "@/paraglide/messages.js";

import { EntryActions, ImportFallback } from "./entry-actions";
import { EntryDescription } from "./entry-description";
import { ProfileExample } from "./entry-samples";
import { EntryUse } from "./entry-use";
import { itemTypesInSentence } from "./labels";

const CHIP =
  "border border-fd-border bg-fd-card px-2 py-0.5 font-sans text-xs font-medium";

export function ProfileEntryPage({ entry }: { entry: SiteEntry }) {
  const { matchedItemTypes } = entry;
  // One order for the item types the page names: the match's, else the entry's.
  const eyebrowTypes = matchedItemTypes ?? entry.itemTypes;
  const chips =
    matchedItemTypes === null
      ? [m.docs_directory_chip_choose(), m.docs_directory_chip_any_source()]
      : [
          m.docs_directory_chip_used_for({
            types: itemTypesInSentence(matchedItemTypes, "singular"),
          }),
          m.docs_directory_chip_other_sources(),
        ];

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6">
      <BackCrumb to="/templates" label={m.docs_directory_title()} />
      <div className="grid gap-x-12 gap-y-10 pt-4.5 pb-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:grid-rows-[auto_1fr]">
        <div className="flex min-w-0 flex-col gap-4 font-serif lg:col-start-1">
          <header>
            <p className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs font-semibold tracking-[0.14em] text-fd-primary uppercase">
              <span>
                {eyebrowTypes.length > 0
                  ? m.docs_directory_ready_made_for({
                      types: itemTypesInSentence(eyebrowTypes, "plural"),
                    })
                  : m.docs_directory_ready_made_any()}
              </span>
              {entry.recommended && (
                <span className="ms-1 border border-fd-primary px-1.5 font-medium tracking-[0.1em]">
                  {m.docs_directory_recommended()}
                </span>
              )}
            </p>
            <h1 className="mb-3 text-4xl leading-[1.16] font-medium text-balance lg:text-[44px]">
              {entry.title}
            </h1>
            <p className="max-w-[60ch] text-lg text-pretty text-fd-muted-foreground italic">
              {entry.summary}
            </p>
          </header>
          <ul className="flex flex-wrap gap-1.5">
            {chips.map((chip, index) => (
              <li
                key={chip}
                className={cn(
                  CHIP,
                  index === 0 && "border-fd-primary text-fd-primary",
                )}
              >
                {chip}
              </li>
            ))}
            <li className={CHIP}>
              {m.docs_directory_requires({ version: entry.minAppVersion })}
            </li>
          </ul>
          <div className="font-sans">
            <EntryActions entry={entry} />
          </div>
          <div className={cn("prose max-w-[60ch] font-sans", ztProse)}>
            <EntryUse entry={entry} />
          </div>
          <div className="flex flex-col gap-2 font-sans">
            <ImportFallback copyText={entry.copyText} />
            <p className="text-sm text-fd-muted-foreground">
              {m.docs_directory_existing_notes()}
            </p>
          </div>
        </div>

        <section
          aria-label={m.docs_directory_samples_item()}
          className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1"
        >
          <ProfileExample notes={entry.notes} />
        </section>

        <details className="group/details min-w-0 border-t border-fd-border pt-3 lg:col-start-1">
          <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1.5 font-mono text-xs font-medium tracking-[0.06em] text-fd-muted-foreground uppercase [&::-webkit-details-marker]:hidden">
            <ChevronDown
              aria-hidden
              className="size-3.5 shrink-0 -rotate-90 group-open/details:rotate-0 rtl:rotate-90 rtl:group-open/details:rotate-0"
            />
            {m.docs_directory_details_heading()}
          </summary>
          <div className="mt-3">
            <EntryDescription markdown={entry.description} />
          </div>
        </details>
      </div>
      <SiteFooter />
    </main>
  );
}
