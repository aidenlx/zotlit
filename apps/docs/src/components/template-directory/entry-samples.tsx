// An entry page's rendered samples: the note it makes for each Directory Sample, shown the way Obsidian's reading view shows it, or as Markdown.

import { Suspense, useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import type {
  AnnotationSampleView,
  NoteSampleView,
  SampleProperty,
  SiteEntry,
} from "@/lib/template-directory/site";
import { ResultSheet } from "@/lib/workbench/result-sheet";
import { m } from "@/paraglide/messages.js";

const SHEET =
  "border border-fd-border bg-fd-card shadow-[6px_6px_0_0_var(--color-fd-border)]";

const LABEL =
  "font-mono text-[0.7rem] font-semibold tracking-[0.1em] text-fd-muted-foreground uppercase";

export function EntrySamples({
  entry,
}: {
  entry: Pick<SiteEntry, "kind" | "notes" | "annotations">;
}) {
  const [showMarkdown, setShowMarkdown] = useState(false);
  const { notes, annotations } = entry;
  const hasBody = notes.some(({ body }) => body !== null);
  const viewToggle = (
    <ViewToggle showMarkdown={showMarkdown} onChange={setShowMarkdown} />
  );

  return (
    <div className="flex flex-col gap-10">
      {entry.kind === "property" ? (
        <PropertyTable notes={notes} />
      ) : (
        hasBody && (
          <Tabs defaultValue={notes[0]?.id}>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <TabsList aria-label={m.docs_directory_samples_item()}>
                {notes.map((note) => (
                  <TabsTrigger key={note.id} value={note.id}>
                    {note.label}
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
      className="min-h-8 cursor-pointer rounded-sm px-3 py-1 text-sm font-medium text-fd-muted-foreground aria-pressed:bg-fd-card aria-pressed:text-fd-foreground aria-pressed:shadow-sm"
    >
      {label}
    </button>
  );
  return (
    <div
      role="group"
      aria-label={m.docs_directory_samples_view()}
      className="flex gap-1 rounded-md bg-fd-muted p-1"
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
          <code className="font-mono text-sm break-all">{note.noteName}</code>
        </p>
      )}
      <div className="flex flex-col p-5 sm:p-6">
        {!showMarkdown && note.properties !== null && (
          <PropertyRows properties={note.properties} />
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
        {annotation.label}
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

/** A note's properties the way Obsidian lists them above the note. */
function PropertyRows({
  properties,
}: {
  properties: readonly SampleProperty[];
}) {
  return (
    <dl
      aria-label={m.docs_directory_sample_properties()}
      className="mb-4 grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-4 gap-y-1 border-b border-fd-border pb-3 text-sm"
    >
      {properties.map(({ key, value }) => (
        <div key={key} className="contents">
          <dt className="font-mono text-xs leading-6 text-fd-muted-foreground">
            {key}
          </dt>
          <dd className="min-w-0 break-words">
            <PropertyValue value={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function PropertyValue({ value }: { value: SampleProperty["value"] }) {
  if (typeof value === "string") return <>{value}</>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {value.map((item, index) => (
        <li
          key={index}
          className="rounded-sm bg-fd-muted px-1.5 text-[0.8rem] leading-6"
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

/** A property recipe's result for every sample item at once: one row per item, one column per property. */
function PropertyTable({ notes }: { notes: readonly NoteSampleView[] }) {
  const keys = [
    ...new Set(
      notes.flatMap(({ properties }) =>
        (properties ?? []).map(({ key }) => key),
      ),
    ),
  ];
  return (
    <div>
      <p className="mb-4 text-fd-muted-foreground">
        {m.docs_directory_property_samples_intro()}
      </p>
      <div className="overflow-x-auto border border-fd-border bg-fd-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-fd-border bg-fd-muted/40">
            <tr>
              <th scope="col" className={cn(LABEL, "px-4 py-2.5")}>
                {m.docs_directory_samples_item()}
              </th>
              {keys.map((key) => (
                <th
                  key={key}
                  scope="col"
                  className="px-4 py-2.5 font-mono text-xs font-semibold"
                >
                  {key}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {notes.map((note) => (
              <tr
                key={note.id}
                className="border-b border-fd-border/60 align-top last:border-b-0"
              >
                <th scope="row" className="px-4 py-2.5 font-medium">
                  {note.label}
                </th>
                {keys.map((key) => {
                  const property = note.properties?.find(
                    (entry) => entry.key === key,
                  );
                  return (
                    <td key={key} className="px-4 py-2.5">
                      {property === undefined ? (
                        <span className="text-fd-muted-foreground italic">
                          {m.docs_directory_sample_left_out()}
                        </span>
                      ) : (
                        <PropertyValue value={property.value} />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
