// A Profile entry's page: the ready-made note first, with one button to add it to ZotLit and the example note beside it.

import { useState } from "react";

import { BackCrumb } from "@/components/back-crumb";
import { SiteFooter } from "@/components/site-footer";
import { cn } from "@/lib/cn";
import { ztProse } from "@/lib/prose";
import type { SiteEntry } from "@/lib/template-directory/site";
import { m } from "@/paraglide/messages.js";

import { ColorKeyList } from "./color-key";
import { EntryActions, ImportFallback } from "./entry-actions";
import { EntryDescription } from "./entry-description";
import { EntryHeading } from "./entry-heading";
import { firstShown, ProfileExample } from "./entry-samples";
import { EntrySource } from "./entry-source";
import { EntryUse } from "./entry-use";
import { Fold } from "./fold";
import { itemTypesInSentence } from "./labels";

const CHIP =
  "border border-fd-border bg-fd-card px-2 py-0.5 font-sans text-xs font-medium";

export function ProfileEntryPage({ entry }: { entry: SiteEntry }) {
  const { matchedItemTypes } = entry;
  const [example, setExample] = useState(firstShown(entry.notes));
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
      <div className="grid gap-x-12 gap-y-10 pt-4.5 pb-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:grid-rows-[auto_auto_1fr]">
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
            <EntryHeading title={entry.title} summary={entry.summary} />
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
          {entry.colorKey !== null && (
            <div className="font-sans">
              <ColorKeyList colorKey={entry.colorKey} />
            </div>
          )}
        </div>

        <section
          aria-label={m.docs_directory_samples_item()}
          className="min-w-0 lg:col-start-2 lg:row-span-3 lg:row-start-1"
        >
          <ProfileExample
            notes={entry.notes}
            selected={example}
            onSelect={setExample}
            shortLabels={
              matchedItemTypes !== null && matchedItemTypes.length > 1
            }
          />
        </section>

        <Fold
          heading={m.docs_directory_details_heading()}
          className="lg:col-start-1"
        >
          <EntryDescription markdown={entry.description} />
        </Fold>

        <EntrySource
          entry={entry}
          example={example}
          className="-mt-7 lg:col-start-1"
        />
      </div>
      <SiteFooter />
    </main>
  );
}
