// Writes one entry's rendered samples as the Markdown page a reviewer reads beside the entry.

import type { DirectoryEntry } from "./load.ts";
import type {
  AnnotationSample,
  CitationSample,
  EntrySamples,
  NoteSample,
} from "./verify.ts";

/** The names the site's messages give the example items and Sample Annotations. */
export interface SampleLabels {
  /** A Directory Sample, an Edge Sample, or a Workbench example set, by id. */
  readonly example: (id: string) => string;
  readonly annotation: (
    annotation: Pick<AnnotationSample, "type" | "color">,
  ) => string;
}

/** The command that rewrites every entry's `samples.md` after a change. */
export const UPDATE_SAMPLES_COMMAND =
  "pnpm exec turbo run test --filter=@zotlit/docs -- src/lib/template-directory -u";

export function formatEntrySamples(
  entry: Pick<DirectoryEntry, "title" | "kind">,
  samples: EntrySamples,
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
  { notes, annotations, citations = [] }: EntrySamples,
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
      `${hashes} Annotation Section`,
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
  { sample, noteName, properties, body }: NoteSample,
  kind: DirectoryEntry["kind"],
  {
    hashes,
    leftOut,
    labels,
  }: { hashes: string; leftOut: string; labels: SampleLabels },
): string {
  const heading = `${hashes} ${labels.example(sample.id)}`;
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
    `Note name: \`${noteName ?? "(none)"}\``,
    codeBlock(note, "markdown"),
  ].join("\n\n");
}

function noteNameTable(
  notes: readonly NoteSample[],
  labels: SampleLabels,
): string {
  return table(
    ["Item", "Note name"],
    notes.map(({ sample, noteName }) => [
      labels.example(sample.id),
      code(noteName),
    ]),
  );
}

function citationTable(
  citations: readonly CitationSample[],
  labels: SampleLabels,
): string {
  return table(
    ["Citation", "Main (Enter)", "Alternate (Shift+Enter)"],
    citations.map(({ id, main, alt }) => [
      labels.example(id),
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
    `| ${cells.map((cell) => cell.replaceAll("|", "\\|")).join(" | ")} |`;
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
