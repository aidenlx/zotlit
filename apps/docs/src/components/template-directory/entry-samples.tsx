// An entry page's rendered samples: the note it makes for each Directory Sample, shown the way Obsidian's reading view shows it, or as Markdown.

import { Suspense, useId, useState } from "react";
import type { ReactNode } from "react";

import {
  segment,
  segmentedTrack,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import type {
  AnnotationSampleView,
  CitationSampleView,
  NoteSampleView,
  SampleProperty,
  SiteEntry,
} from "@/lib/template-directory/site";
import { ResultSheet } from "@/lib/workbench/result-sheet";
import { m } from "@/paraglide/messages.js";

import {
  annotationLabel,
  exampleLabel,
  LEGEND_MARK_LABEL,
  ROW_MARK_LABEL,
  shortExampleLabel,
} from "./labels";

/**
 * Obsidian's colors for its built-in callout types, so a sample shows each
 * callout in the color the reader's note shows. Any other type shows as a note.
 */
const CALLOUT_COLORS = [
  "[&_.callout]:[--zt-callout:rgb(8,109,221)]",
  "[&_.callout:is([data-callout=abstract],[data-callout=summary],[data-callout=tldr],[data-callout=tip],[data-callout=hint],[data-callout=important])]:[--zt-callout:rgb(0,191,188)]",
  "[&_.callout:is([data-callout=success],[data-callout=check],[data-callout=done])]:[--zt-callout:rgb(8,185,78)]",
  "[&_.callout:is([data-callout=question],[data-callout=help],[data-callout=faq],[data-callout=warning],[data-callout=attention],[data-callout=caution])]:[--zt-callout:rgb(236,117,0)]",
  "[&_.callout:is([data-callout=failure],[data-callout=missing],[data-callout=fail],[data-callout=danger],[data-callout=error],[data-callout=bug])]:[--zt-callout:rgb(233,49,71)]",
  "[&_.callout[data-callout=example]]:[--zt-callout:rgb(120,82,238)]",
  "[&_.callout:is([data-callout=quote],[data-callout=cite])]:[--zt-callout:rgb(158,158,158)]",
  "[&_.callout[data-callout]]:border-(--zt-callout) [&_.callout[data-callout]]:bg-(--zt-callout)/10",
  "[&_.callout[data-callout]>.callout-title]:text-[color-mix(in_oklab,var(--zt-callout)_70%,var(--color-fd-foreground))]",
].join(" ");

/**
 * The note's text as Obsidian shows it: callout titles in their own words and
 * case, and quotes upright, without the quotation marks the prose style adds.
 */
const OBSIDIAN_TEXT = [
  "[&_.callout[data-callout]>.callout-title]:font-sans [&_.callout[data-callout]>.callout-title]:[font-size:inherit] [&_.callout[data-callout]>.callout-title]:tracking-normal [&_.callout[data-callout]>.callout-title]:normal-case",
  "prose-blockquote:not-italic [&_blockquote_p]:before:content-none [&_blockquote_p]:after:content-none",
].join(" ");

const SHEET = cn(
  "border border-fd-border bg-fd-card shadow-[6px_6px_0_0_var(--color-fd-border)]",
  CALLOUT_COLORS,
  OBSIDIAN_TEXT,
);

/** The first sample item the entry shows something for, so the page opens on real output. */
export function firstShown(
  notes: readonly NoteSampleView[],
): string | undefined {
  return (notes.find(({ body }) => body?.trim()) ?? notes[0])?.id;
}

const LABEL =
  "font-mono text-[0.72rem] font-semibold tracking-[0.1em] text-fd-muted-foreground uppercase";

/** An example switcher wraps on a wide screen and scrolls sideways on a phone, one row of tabs that keep their names whole. */
const SWITCHER =
  "max-w-full max-sm:w-max max-sm:flex-nowrap max-sm:overflow-x-auto";
const SWITCHER_TAB = "max-sm:shrink-0 max-sm:whitespace-nowrap";

/**
 * A Profile's example note as Obsidian's reading view shows it, under a
 * switcher that names each example item. The switcher wraps on a wide screen
 * and scrolls sideways on a phone. The page holds the selection, so its Source
 * section can show the Markdown of the same example.
 */
export function ProfileExample({
  notes,
  selected,
  onSelect,
  shortLabels = false,
}: {
  notes: readonly NoteSampleView[];
  selected: string | undefined;
  onSelect: (id: string) => void;
  /** Name the tabs by item type, for a Profile that takes several item types. */
  shortLabels?: boolean;
}) {
  const labelId = useId();
  return (
    <Tabs value={selected} onValueChange={(id) => onSelect(String(id))}>
      <p id={labelId} className={cn(LABEL, "mb-2")}>
        {m.docs_directory_see_it_with()}
      </p>
      <TabsList aria-labelledby={labelId} className={cn("mb-4", SWITCHER)}>
        {notes.map((note) => (
          <TabsTrigger key={note.id} value={note.id} className={SWITCHER_TAB}>
            {(shortLabels ? shortExampleLabel : exampleLabel)(note)}
          </TabsTrigger>
        ))}
      </TabsList>
      {notes.map((note) => (
        <TabsContent key={note.id} value={note.id}>
          <NoteSheet note={note} showMarkdown={false} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

export function EntrySamples({
  entry,
}: {
  entry: Pick<SiteEntry, "kind" | "notes" | "annotations" | "citations">;
}) {
  const [showMarkdown, setShowMarkdown] = useState(false);
  const { notes, annotations } = entry;
  if (entry.kind === "citation") {
    return <CitationSamples citations={entry.citations} />;
  }
  if (entry.kind === "note-name") return <NoteNameSamples notes={notes} />;
  const hasBody = notes.some(({ body }) => body !== null);
  const viewToggle = (
    <ViewToggle showMarkdown={showMarkdown} onChange={setShowMarkdown} />
  );

  return (
    <div className="flex flex-col gap-10">
      {entry.kind === "property" ? (
        <PropertySamples notes={notes} />
      ) : (
        hasBody && (
          <Tabs defaultValue={firstShown(notes)}>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <TabsList
                aria-label={m.docs_directory_samples_item()}
                className={SWITCHER}
              >
                {notes.map((note) => (
                  <TabsTrigger
                    key={note.id}
                    value={note.id}
                    className={SWITCHER_TAB}
                  >
                    {exampleLabel(note)}
                  </TabsTrigger>
                ))}
              </TabsList>
              {viewToggle}
            </div>
            {notes.map((note) => (
              <TabsContent key={note.id} value={note.id}>
                <NoteSheet note={note} showMarkdown={showMarkdown} />
              </TabsContent>
            ))}
          </Tabs>
        )
      )}
      {annotations.length > 0 && (
        <section aria-labelledby="sample-annotations">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <h3
              id="sample-annotations"
              className="font-serif text-xl font-medium"
            >
              {m.docs_directory_samples_annotations()}
            </h3>
            {!hasBody && viewToggle}
          </div>
          <p className="mb-5 text-fd-muted-foreground">
            {m.docs_directory_samples_annotations_intro()}
          </p>
          <ul className="grid gap-6 md:grid-cols-2">
            {annotations.map((annotation) => (
              <AnnotationSheet
                key={annotation.id}
                annotation={annotation}
                showMarkdown={showMarkdown}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ViewToggle({
  showMarkdown,
  onChange,
}: {
  showMarkdown: boolean;
  onChange: (showMarkdown: boolean) => void;
}) {
  const option = (markdown: boolean, label: string) => (
    <button
      type="button"
      aria-pressed={showMarkdown === markdown}
      onClick={() => onChange(markdown)}
      className={segment}
    >
      {label}
    </button>
  );
  return (
    <div
      role="group"
      aria-label={m.docs_directory_samples_view()}
      className={segmentedTrack}
    >
      {option(false, m.docs_directory_samples_preview())}
      {option(true, m.docs_directory_samples_markdown())}
    </div>
  );
}

function NoteSheet({
  note,
  showMarkdown,
}: {
  note: NoteSampleView;
  showMarkdown: boolean;
}) {
  return (
    <article className={SHEET}>
      {note.noteName !== null && (
        <p className="flex flex-wrap items-baseline gap-x-2 border-b border-fd-border bg-fd-muted/40 px-5 py-2">
          <span className={LABEL}>{m.docs_directory_sample_note_name()}</span>
          <code className="font-mono text-sm break-words">{note.noteName}</code>
        </p>
      )}
      <div className="flex flex-col p-5 sm:p-6">
        {!showMarkdown && note.properties !== null && (
          <div className="mb-4 border-b border-fd-border pb-3">
            <PropertyRows properties={note.properties} marked />
            <PropertyKey properties={note.properties} />
          </div>
        )}
        <Sheet
          markdown={note.body ?? ""}
          frontmatter={note.frontmatter}
          showMarkdown={showMarkdown}
        />
      </div>
    </article>
  );
}

function AnnotationSheet({
  annotation,
  showMarkdown,
}: {
  annotation: AnnotationSampleView;
  showMarkdown: boolean;
}) {
  return (
    <li className={cn(SHEET, "flex flex-col")}>
      <p className={cn(LABEL, "border-b border-fd-border px-4 py-2")}>
        {annotationLabel(annotation)}
      </p>
      <div className="flex flex-1 flex-col p-4">
        <Sheet
          markdown={annotation.output ?? ""}
          frontmatter={null}
          showMarkdown={showMarkdown}
        />
      </div>
    </li>
  );
}

/** The Workbench's reading view, which carries the Markdown parser stack behind a lazy import. */
function Sheet({
  markdown,
  frontmatter,
  showMarkdown,
}: {
  markdown: string;
  frontmatter: string | null;
  showMarkdown: boolean;
}) {
  if (!markdown.trim() && !(showMarkdown && frontmatter)) {
    return (
      <p className="text-sm text-fd-muted-foreground italic">
        {m.docs_directory_sample_nothing()}
      </p>
    );
  }
  return (
    <Suspense
      fallback={
        <pre className="font-mono text-[0.8rem] leading-relaxed break-words whitespace-pre-wrap">
          {markdown}
        </pre>
      }
    >
      <ResultSheet
        markdown={markdown}
        properties={[]}
        frontmatterBlock={frontmatter}
        showMarkdown={showMarkdown}
      />
    </Suspense>
  );
}

/**
 * A note's properties the way Obsidian lists them above the note. Given the
 * keys a rule writes, it also lists each one this note leaves out.
 */
function PropertyRows({
  properties,
  keys = properties.map(({ key }) => key),
  marked = false,
  className,
}: {
  properties: readonly SampleProperty[];
  keys?: readonly string[];
  /** Show which properties the look sets and which ZotLit adds to every note. */
  marked?: boolean;
  className?: string;
}) {
  return (
    <dl
      aria-label={m.docs_directory_sample_properties()}
      className={cn(
        "grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-4 gap-y-1 text-sm",
        className,
      )}
    >
      {keys.map((key) => {
        const property = properties.find((entry) => entry.key === key);
        const mark = marked ? property?.mark : undefined;
        return (
          <div
            key={key}
            className={cn(
              "contents",
              mark !== undefined &&
                cn(
                  "col-span-2 grid grid-cols-subgrid items-baseline px-2",
                  MARK_ROW[mark],
                ),
            )}
          >
            <dt
              className={cn(
                "font-mono text-xs leading-6",
                mark === "set"
                  ? "font-semibold text-fd-foreground"
                  : "text-fd-muted-foreground",
              )}
            >
              {mark !== undefined && (
                <span className="sr-only">{ROW_MARK_LABEL[mark]()}: </span>
              )}
              {key}
            </dt>
            <dd className="min-w-0 break-words">
              <PropertyCell property={property} />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** How each mark looks: the look's own properties on the accent tint with a bar, ZotLit's on a grey one. */
const MARK_ROW = {
  set: "bg-fd-accent shadow-[inset_3px_0_0_var(--color-fd-primary)]",
  system: "bg-fd-muted text-fd-muted-foreground",
} satisfies Record<SampleProperty["mark"], string>;

/** The key under a note's properties, for each mark the note shows. */
function PropertyKey({
  properties,
}: {
  properties: readonly SampleProperty[];
}) {
  const shown = (["set", "system"] as const).filter((mark) =>
    properties.some((property) => property.mark === mark),
  );
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-sans text-xs text-fd-muted-foreground">
      {shown.map((mark) => (
        <li key={mark} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn("size-2.5 border border-fd-border", MARK_ROW[mark])}
          />
          {LEGEND_MARK_LABEL[mark]()}
        </li>
      ))}
    </ul>
  );
}

function PropertyCell({ property }: { property: SampleProperty | undefined }) {
  if (property === undefined) {
    return (
      <span className="text-fd-muted-foreground italic">
        {m.docs_directory_sample_left_out()}
      </span>
    );
  }
  return <PropertyValue value={property.value} />;
}

function PropertyValue({ value }: { value: SampleProperty["value"] }) {
  if (value === null) {
    return (
      <span className="text-fd-muted-foreground italic">
        {m.docs_directory_sample_empty()}
      </span>
    );
  }
  if (typeof value === "string") return <>{value}</>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {value.map((item, index) => (
        <li
          key={index}
          className="rounded-sm border border-fd-border bg-fd-card px-1.5 text-[0.8rem] leading-6"
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

/** A citation text's result: the citation it inserts for each sample, under both variants. */
function CitationSamples({
  citations,
}: {
  citations: readonly CitationSampleView[];
}) {
  const cell = (text: string | null) =>
    text === null ? <PropertyValue value={null} /> : text;
  return (
    <div>
      <p className="mt-1 mb-6 text-fd-muted-foreground">
        {m.docs_directory_citation_samples_intro()}
      </p>
      <SampleTable
        heading={m.docs_directory_citation_cited()}
        columns={[
          m.docs_directory_citation_main(),
          m.docs_directory_citation_alt(),
        ]}
        rows={citations.map((citation) => ({
          id: citation.id,
          label: exampleLabel(citation),
          cells: [cell(citation.main), cell(citation.alt)],
        }))}
      />
    </div>
  );
}

/** A note-name entry's result: the name it gives a new note for each sample item. */
function NoteNameSamples({ notes }: { notes: readonly NoteSampleView[] }) {
  return (
    <div>
      <p className="mt-1 mb-6 text-fd-muted-foreground">
        {m.docs_directory_note_name_samples_intro()}
      </p>
      <SampleTable
        heading={m.docs_directory_samples_item()}
        columns={[m.docs_directory_sample_note_name()]}
        rows={notes.map((note) => ({
          id: note.id,
          label: exampleLabel(note),
          cells: [nameCell(note.noteName)],
        }))}
      />
    </div>
  );
}

function nameCell(noteName: string | null): ReactNode {
  if (noteName === null) return <PropertyValue value={null} />;
  return (
    <code className="font-mono text-[0.8rem] [overflow-wrap:anywhere]">
      {noteName}
    </code>
  );
}

/** One row per sample, one column per result: the shape every recipe's samples table takes. */
function SampleTable({
  heading,
  columns,
  rows,
  monoColumns = false,
}: {
  heading: string;
  columns: readonly string[];
  rows: readonly { id: string; label: string; cells: readonly ReactNode[] }[];
  monoColumns?: boolean;
}) {
  return (
    <div className="overflow-x-auto border border-fd-border bg-fd-card">
      <table className="w-full text-start text-sm">
        <thead className="border-b border-fd-border bg-fd-muted/40">
          <tr>
            <th scope="col" className={cn(LABEL, "px-4 py-2.5 text-start")}>
              {heading}
            </th>
            {columns.map((column) => (
              <th
                key={column}
                scope="col"
                className={cn(
                  "px-4 py-2.5 text-start",
                  monoColumns ? "font-mono text-xs font-semibold" : LABEL,
                )}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-fd-border/60 align-top last:border-b-0"
            >
              <th scope="row" className="px-4 py-2.5 text-start font-medium">
                {row.label}
              </th>
              {row.cells.map((cell, index) => (
                <td key={columns[index]} className="px-4 py-2.5">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The most properties the table shows side by side; a rule that writes more shows one sample item at a time. */
const TABLE_KEYS = 3;

/** A property recipe's result for every sample item, with each property the rule writes. */
function PropertySamples({ notes }: { notes: readonly NoteSampleView[] }) {
  const keys = [
    ...new Set(
      notes.flatMap(({ properties }) =>
        (properties ?? []).map(({ key }) => key),
      ),
    ),
  ];
  return (
    <div>
      <p className="mt-1 mb-6 text-fd-muted-foreground">
        {m.docs_directory_property_samples_intro()}
      </p>
      {keys.length > TABLE_KEYS ? (
        <Tabs defaultValue={notes[0]?.id}>
          <TabsList
            aria-label={m.docs_directory_samples_item()}
            className={cn("mb-5", SWITCHER)}
          >
            {notes.map((note) => (
              <TabsTrigger
                key={note.id}
                value={note.id}
                className={SWITCHER_TAB}
              >
                {exampleLabel(note)}
              </TabsTrigger>
            ))}
          </TabsList>
          {notes.map((note) => (
            <TabsContent key={note.id} value={note.id}>
              <div className={cn(SHEET, "p-5 sm:p-6")}>
                <PropertyRows properties={note.properties ?? []} keys={keys} />
              </div>
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        <PropertyTable notes={notes} keys={keys} />
      )}
    </div>
  );
}

/** A few properties for every sample item at once: one row per item, one column per property. */
function PropertyTable({
  notes,
  keys,
}: {
  notes: readonly NoteSampleView[];
  keys: readonly string[];
}) {
  return (
    <SampleTable
      heading={m.docs_directory_samples_item()}
      columns={keys}
      monoColumns
      rows={notes.map((note) => ({
        id: note.id,
        label: exampleLabel(note),
        cells: keys.map((key) => (
          <PropertyCell
            key={key}
            property={note.properties?.find((entry) => entry.key === key)}
          />
        )),
      }))}
    />
  );
}
