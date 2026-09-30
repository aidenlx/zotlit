// A part entry's page (a partial, a property rule, a note name, or a citation text): the result for each example item first, then the look it changes, one Copy button, and the steps.

import { BackCrumb } from "@/components/back-crumb";
import { Message } from "@/components/message";
import { SiteFooter } from "@/components/site-footer";
import { cn } from "@/lib/cn";
import { ztProse } from "@/lib/prose";
import type { PartEntry } from "@/lib/template-directory/site";
import { m } from "@/paraglide/messages.js";

import { CopyButton } from "./entry-actions";
import { EntryDescription } from "./entry-description";
import { EntryHeading } from "./entry-heading";
import { EntryLink } from "./entry-list";
import { EntrySamples } from "./entry-samples";
import { EntrySource } from "./entry-source";
import { EntryChanges, EntryUse } from "./entry-use";
import { Fold } from "./fold";
import { SummaryText } from "./summary-text";

const HEADING = "font-serif text-2xl font-medium";

/** What each kind of part is, with what it changes, as its eyebrow says. */
const EYEBROW = {
  partial: m.docs_directory_part_eyebrow_partial,
  property: m.docs_directory_part_eyebrow_property,
  "note-name": m.docs_directory_part_eyebrow_note_name,
  citation: m.docs_directory_part_eyebrow_citation,
} satisfies Record<PartEntry["kind"], () => string>;

export function PartEntryPage({ entry }: { entry: PartEntry }) {
  const { kind, calledPartials } = entry;
  const hasSamples =
    entry.notes.length > 0 ||
    entry.annotations.length > 0 ||
    entry.citations.length > 0;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6">
      <BackCrumb to="/templates" label={m.docs_directory_title()} />
      <header className="max-w-3xl pt-4.5 pb-8 font-serif">
        <p className="mb-3 font-mono text-xs font-semibold tracking-[0.14em] text-fd-primary uppercase">
          {EYEBROW[kind]()}
        </p>
        <EntryHeading title={entry.title} summary={entry.summary} />
        <p className="mt-4 font-mono text-xs font-medium tracking-widest text-fd-muted-foreground uppercase">
          <Message
            text={m.docs_directory_requires({ version: "{version}" })}
            slots={{
              version: (
                <span className="normal-case">{entry.minAppVersion}</span>
              ),
            }}
          />
        </p>
      </header>

      <div className="flex max-w-4xl min-w-0 flex-col gap-12 border-t border-fd-border pt-10 pb-14">
        {hasSamples && (
          <section aria-labelledby="samples">
            <h2 id="samples" className={HEADING}>
              {m.docs_directory_samples_heading()}
            </h2>
            {entry.kind === "partial" && (
              <p className="mt-1 mb-6 text-fd-muted-foreground">
                {m.docs_directory_samples_intro()}
              </p>
            )}
            <EntrySamples entry={entry} />
          </section>
        )}

        <section aria-labelledby="use">
          <h2 id="use" className={HEADING}>
            {m.docs_directory_use_heading()}
          </h2>
          <div className={cn("prose mt-2 max-w-[72ch]", ztProse)}>
            <EntryChanges entry={entry} />
            <div className="not-prose my-4 font-sans">
              <CopyButton kind={entry.kind} copyText={entry.copyText} />
            </div>
            <EntryUse entry={entry} />
          </div>
        </section>

        {calledPartials.length > 0 && (
          <section aria-labelledby="partials">
            <h2 id="partials" className={HEADING}>
              {m.docs_directory_calls_heading()}
            </h2>
            <p className="mt-1 mb-4 text-fd-muted-foreground">
              {m.docs_directory_calls_recipe()}
            </p>
            <ul className="border-t border-fd-border">
              {calledPartials.map((partial) => (
                <li
                  key={partial.id}
                  className="border-b border-fd-border/60 py-3"
                >
                  <EntryLink
                    id={partial.id}
                    className="font-serif text-lg font-medium decoration-fd-primary underline-offset-4 hover:text-fd-primary hover:underline"
                  >
                    {partial.title}
                  </EntryLink>
                  <p className="text-sm text-fd-muted-foreground">
                    <SummaryText text={partial.summary} />
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="flex flex-col gap-6">
          <Fold heading={m.docs_directory_details_heading()}>
            <EntryDescription markdown={entry.description} />
          </Fold>
          <EntrySource entry={entry} example={undefined} />
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}
