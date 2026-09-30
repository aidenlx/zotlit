// Writes one entry's rendered samples as the Markdown page a reviewer reads beside the entry.

import type { DirectoryEntry } from "./load.ts";
import type { SampleName } from "./samples.ts";
import type { SampleProperty } from "./site.ts";
import type {
  AnnotationSample,
  CitationSample,
  EntrySamples,
  NoteSample,
} from "./verify.ts";

/** The names and headings the site's messages give the samples. */
export interface SampleLabels {
  /** A Directory Sample, an Edge Sample, or a Workbench example set. */
  readonly example: (sample: SampleName) => string;
  readonly annotation: (
    annotation: Pick<AnnotationSample, "type" | "color">,
  ) => string;
  /** The heading over the Sample Annotations. */
  readonly annotations: () => string;
  /** The column of example items in a table. */
  readonly item: () => string;
  /** A sample's note name, as a column and as the label over a Profile's note. */
  readonly noteName: () => string;
  /** The columns of a Profile's property table, and the name of each mark. */
  readonly property: () => string;
  readonly value: () => string;
  readonly mark: () => string;
  readonly markName: (mark: SampleProperty["mark"]) => string;
  /** A property the reader fills in by hand. */
  readonly empty: () => string;
  /** The columns of the citation table: the items cited, then each citation. */
  readonly cited: () => string;
  readonly main: () => string;
  readonly alt: () => string;
}

/** The command that rewrites every entry's `samples.md` after a change. */
export const UPDATE_SAMPLES_COMMAND =
  "pnpm exec turbo run test --filter=@zotlit/docs -- src/lib/template-directory -u";

/**
 * A note's rendered sample. A Profile's page gives its properties as `rows`
 * too, marked as set by the Profile or added by ZotLit, and the sample then
 * tabulates them above the note.
 */
export type NoteSampleRows = NoteSample & {
  readonly rows?: readonly SampleProperty[];
};

export interface EntrySampleRows extends Omit<EntrySamples, "notes"> {
  readonly notes: readonly NoteSampleRows[];
}

export function formatEntrySamples(
  entry: Pick<DirectoryEntry, "title" | "kind">,
  samples: EntrySampleRows,
  labels: SampleLabels,
): string {
  const sections = [
    `<!-- Written by the Template Directory verification suite; do not edit. Update with: ${UPDATE_SAMPLES_COMMAND} -->`,
    `# Rendered samples: ${entry.title}`,
    ...formatSampleSections(entry.kind, samples, { depth: 2, labels }),
  ];
  return `${sections.join("\n\n")}\n`;
}

/**
 * One entry's rendered samples as Markdown sections, each sample under a
 * heading of `depth`, so a page can place them below a heading of its own.
 * `leftOut` is what a property sample shows when the rule writes nothing.
 */
export function formatSampleSections(
  kind: DirectoryEntry["kind"],
  { notes, annotations, citations = [] }: EntrySampleRows,
  {
    depth,
    leftOut = NO_OUTPUT,
    labels,
  }: { depth: number; leftOut?: string; labels: SampleLabels },
): string[] {
  const hashes = "#".repeat(depth);
  const sections =
    kind === "note-name"
      ? [noteNameTable(notes, labels)]
      : notes.map((note) =>
          noteSection(note, kind, { hashes, leftOut, labels }),
        );
  if (citations.length > 0) sections.push(citationTable(citations, labels));
  if (annotations.length > 0) {
    sections.push(
      `${hashes} ${labels.annotations()}`,
      ...annotations.map((annotation) =>
        [
          `${hashes}# ${labels.annotation(annotation)}`,
          codeBlock(annotation.output, "markdown"),
        ].join("\n\n"),
      ),
    );
  }
  return sections;
}

function noteSection(
  { sample, noteName, properties, rows, body }: NoteSampleRows,
  kind: DirectoryEntry["kind"],
  {
    hashes,
    leftOut,
    labels,
  }: { hashes: string; leftOut: string; labels: SampleLabels },
): string {
  const heading = `${hashes} ${labels.example(sample)}`;
  if (kind === "property")
    return [
      heading,
      isEmpty(properties) ? leftOut : codeBlock(properties, "yaml"),
    ].join("\n\n");
  if (kind !== "profile")
    return [heading, codeBlock(body, "markdown")].join("\n\n");
  const note =
    body === null
      ? null
      : properties === null
        ? body
        : `---\n${properties}---\n${body}`;
  return [
    heading,
    `${labels.noteName()}: \`${noteName ?? "(none)"}\``,
    ...(rows === undefined || rows.length === 0
      ? []
      : [propertyTable(rows, labels)]),
    codeBlock(note, "markdown"),
  ].join("\n\n");
}

function propertyTable(
  rows: readonly SampleProperty[],
  labels: SampleLabels,
): string {
  return table(
    [labels.property(), labels.value(), labels.mark()],
    rows.map(({ key, value, mark }) => [
      key,
      value === null
        ? `_${labels.empty()}_`
        : typeof value === "string"
          ? value
          : value.join(", "),
      labels.markName(mark),
    ]),
  );
}

function noteNameTable(
  notes: readonly NoteSample[],
  labels: SampleLabels,
): string {
  return table(
    [labels.item(), labels.noteName()],
    notes.map(({ sample, noteName }) => [
      labels.example(sample),
      code(noteName),
    ]),
  );
}

function citationTable(
  citations: readonly CitationSample[],
  labels: SampleLabels,
): string {
  return table(
    [labels.cited(), labels.main(), labels.alt()],
    citations.map(({ sample, main, alt }) => [
      labels.example(sample),
      code(main),
      code(alt),
    ]),
  );
}

function table(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const line = (cells: readonly string[]) =>
    `| ${cells.map((cell) => cell.replaceAll("|", "\\|").replaceAll(/\s*\n\s*/g, " ")).join(" | ")} |`;
  return [
    line(headers),
    line(headers.map(() => "---")),
    ...rows.map(line),
  ].join("\n");
}

/** What a sample shows when it renders nothing. */
const NO_OUTPUT = "_No output._";

function isEmpty(content: string | null): boolean {
  return content === null || content.trim() === "";
}

/** An inline code span one backtick longer than any run inside it. */
function code(content: string | null): string {
  if (content === null || isEmpty(content)) return NO_OUTPUT;
  const longest = Math.max(
    0,
    ...[...content.matchAll(/`+/g)].map(([run]) => run.length),
  );
  const fence = "`".repeat(longest + 1);
  const pad = content.startsWith("`") || content.endsWith("`") ? " " : "";
  return `${fence}${pad}${content}${pad}${fence}`;
}

/** A fenced block one backtick longer than any run inside it, so it never closes early. */
export function codeBlock(content: string | null, language: string): string {
  if (content === null || isEmpty(content)) return NO_OUTPUT;
  const longest = Math.max(
    2,
    ...[...content.matchAll(/`+/g)].map(([run]) => run.length),
  );
  const fence = "`".repeat(longest + 1);
  return `${fence}${language}\n${content.replace(/\n$/, "")}\n${fence}`;
}
