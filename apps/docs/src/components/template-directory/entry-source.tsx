// An entry page's Source section: the file behind the page, folded at the end for advanced readers.

import { ChevronDown, Copy, Download } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { Message } from "@/components/message";
import { UiLabel } from "@/components/ui-label";
import {
  segment,
  segmentedTrack,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import { noteMarkdown } from "@/lib/template-directory/site";
import type { SiteEntry } from "@/lib/template-directory/site";
import { m } from "@/paraglide/messages.js";

import { copyToClipboard, downloadFile } from "./entry-actions";
import { EntryLink } from "./entry-list";
import { COPY_LABEL, exampleLabel } from "./labels";

const ACTION =
  "inline-flex min-h-8 cursor-pointer items-center gap-2 border border-fd-border bg-fd-card px-3 py-1 text-sm font-medium transition-colors hover:border-fd-primary hover:text-fd-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring [&_svg]:size-4";

/** The partials a Profile's page can title and link: the entries its file calls. */
export interface SourcePartialEntry {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
}

/**
 * The folded Source section. A Profile offers one tab for its file, one for
 * each partial it packs, and one for the raw Markdown of the example shown
 * above; any other entry folds its own file.
 */
export function EntrySource({
  entry,
  partials,
  example,
  className,
}: {
  entry: Pick<
    SiteEntry,
    "kind" | "copyText" | "file" | "profileSource" | "notes"
  >;
  partials: readonly SourcePartialEntry[];
  /** The example item the page shows now; the example tab holds its Markdown. */
  example: string | undefined;
  className?: string;
}) {
  return (
    <Fold heading={m.docs_directory_source_heading()} className={className}>
      {entry.profileSource === null ? (
        <>
          <p className="font-mono text-xs break-all text-fd-muted-foreground">
            {entry.file.name}
          </p>
          <SourceCode text={entry.file.text} label={entry.file.name} />
        </>
      ) : (
        <ProfileSourceTabs
          entry={entry}
          source={entry.profileSource}
          partials={partials}
          example={example}
        />
      )}
    </Fold>
  );
}

/** A folded section of an entry page, opened by its heading. */
export function Fold({
  heading,
  className,
  children,
}: {
  heading: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details
      className={cn(
        "group/details min-w-0 border-t border-fd-border pt-3",
        className,
      )}
    >
      <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1.5 font-mono text-xs font-medium tracking-[0.06em] text-fd-muted-foreground uppercase [&::-webkit-details-marker]:hidden">
        <ChevronDown
          aria-hidden
          className="size-3.5 shrink-0 -rotate-90 group-open/details:rotate-0 rtl:rotate-90 rtl:group-open/details:rotate-0"
        />
        {heading}
      </summary>
      <div className="mt-3 flex flex-col gap-3 font-sans">{children}</div>
    </details>
  );
}

const FILE_TAB = "file";
const EXAMPLE_TAB = "example";
const partialTab = (name: string) => `partial:${name}`;

function ProfileSourceTabs({
  entry,
  source,
  partials,
  example,
}: {
  entry: Pick<SiteEntry, "copyText" | "file" | "notes">;
  source: NonNullable<SiteEntry["profileSource"]>;
  partials: readonly SourcePartialEntry[];
  example: string | undefined;
}) {
  const [whole, setWhole] = useState(false);
  const shown = entry.notes.find(({ id }) => id === example);
  const trigger = "max-sm:shrink-0 max-sm:whitespace-nowrap";
  return (
    <Tabs defaultValue={FILE_TAB}>
      <div className="mb-3 max-sm:overflow-x-auto">
        <TabsList
          aria-label={m.docs_directory_source_files()}
          className="max-sm:w-max max-sm:flex-nowrap"
        >
          <TabsTrigger value={FILE_TAB} className={cn(trigger, "font-mono")}>
            {entry.file.name}
          </TabsTrigger>
          {source.partials.map(({ name }) => (
            <TabsTrigger
              key={name}
              value={partialTab(name)}
              className={cn(trigger, "font-mono")}
            >
              {name}
            </TabsTrigger>
          ))}
          {shown && (
            <TabsTrigger value={EXAMPLE_TAB} className={trigger}>
              {m.docs_directory_source_example_tab()}
            </TabsTrigger>
          )}
        </TabsList>
      </div>

      <TabsContent value={FILE_TAB} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div
            role="group"
            aria-label={m.docs_directory_source_view()}
            className={segmentedTrack}
          >
            <button
              type="button"
              aria-pressed={!whole}
              onClick={() => setWhole(false)}
              className={segment}
            >
              {m.docs_directory_source_note_part()}
            </button>
            <button
              type="button"
              aria-pressed={whole}
              onClick={() => setWhole(true)}
              className={segment}
            >
              {m.docs_directory_source_whole_file()}
            </button>
          </div>
          <button
            type="button"
            onClick={() =>
              copyToClipboard(entry.copyText, m.docs_directory_copy_failed())
            }
            className={ACTION}
          >
            <Copy aria-hidden />
            {COPY_LABEL.profile()}
          </button>
          <button
            type="button"
            onClick={() => downloadFile(entry.file)}
            className={ACTION}
          >
            <Download aria-hidden />
            {m.docs_directory_download()}
          </button>
        </div>
        <p className="max-w-[60ch] text-sm text-pretty text-fd-muted-foreground">
          <Message
            text={m.docs_directory_source_profile_hint({ import: "{import}" })}
            slots={{ import: <UiLabel name={m.docs_directory_import()} /> }}
          />
        </p>
        <SourceCode
          text={whole ? entry.file.text : source.note}
          label={
            whole
              ? m.docs_directory_source_whole_file()
              : m.docs_directory_source_note_part()
          }
        />
      </TabsContent>

      {source.partials.map(({ name, id }) => {
        const partial = partials.find((candidate) => candidate.id === id);
        return (
          <TabsContent
            key={name}
            value={partialTab(name)}
            className="flex flex-col gap-2 text-sm"
          >
            {id !== null && partial ? (
              <>
                <p className="max-w-[60ch] text-pretty text-fd-muted-foreground">
                  {partial.summary}
                </p>
                <EntryLink
                  id={id}
                  className="w-fit font-medium text-fd-foreground underline decoration-fd-primary underline-offset-4 hover:text-fd-primary"
                >
                  {m.docs_directory_source_partial_open({
                    title: partial.title,
                  })}
                </EntryLink>
              </>
            ) : (
              <p className="text-fd-muted-foreground">
                {m.docs_directory_source_partial_packed()}
              </p>
            )}
          </TabsContent>
        );
      })}

      {shown && (
        <TabsContent value={EXAMPLE_TAB} className="flex flex-col gap-3">
          <p className="max-w-[60ch] text-sm text-pretty text-fd-muted-foreground">
            {m.docs_directory_source_example_hint({
              example: exampleLabel(shown.id),
            })}
          </p>
          <SourceCode
            text={noteMarkdown(shown)}
            label={m.docs_directory_source_example_tab()}
          />
        </TabsContent>
      )}
    </Tabs>
  );
}

/** A file's text, in a box that scrolls and takes the keyboard. */
function SourceCode({ text, label }: { text: string; label: string }) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="max-h-96 overflow-auto border border-fd-border bg-fd-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring"
    >
      <pre
        dir="ltr"
        className="w-max min-w-full p-3 font-mono text-xs leading-relaxed"
      >
        {text}
      </pre>
    </div>
  );
}
