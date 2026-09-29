// Writes one entry's rendered samples as the Markdown page a reviewer reads beside the entry.

import type { DirectoryEntry } from "./load.ts";
import type { CitationSample, EntrySamples, NoteSample } from "./verify.ts";

/** The command that rewrites every entry's `samples.md` after a change. */
export const UPDATE_SAMPLES_COMMAND =
  "pnpm exec turbo run test --filter=@zotlit/docs -- src/lib/template-directory -u";

export function formatEntrySamples(
  entry: Pick<DirectoryEntry, "title" | "kind">,
  samples: EntrySamples,
): string {
  const sections = [
    `<!-- Written by the Template Directory verification suite; do not edit. Update with: ${UPDATE_SAMPLES_COMMAND} -->`,
    `# Rendered samples: ${entry.title}`,
    ...formatSampleSections(entry.kind, samples, 2),
  ];
  return `${sections.join("\n\n")}\n`;
}

/**
 * One entry's rendered samples as Markdown sections, each sample under a
 * heading of `depth`, so a page can place them below a heading of its own.
 */
export function formatSampleSections(
  kind: DirectoryEntry["kind"],
  { notes, annotations, citations = [] }: EntrySamples,
  depth: number,
): string[] {
  const hashes = "#".repeat(depth);
  const sections =
    kind === "note-name"
      ? [noteNameTable(notes)]
      : notes.map((note) => noteSection(note, kind, hashes));
  if (citations.length > 0) sections.push(citationTable(citations));
  if (annotations.length > 0) {
    sections.push(
      `${hashes} Annotation Section`,
      ...annotations.map(({ label, output }) =>
        [`${hashes}# ${capitalize(label)}`, codeBlock(output, "markdown")].join(
          "\n\n",
        ),
      ),
    );
  }
  return sections;
}

function noteSection(
  { sample, noteName, properties, body }: NoteSample,
  kind: DirectoryEntry["kind"],
  hashes: string,
): string {
  const heading = `${hashes} ${sample.label}`;
  if (kind === "property")
    return [heading, codeBlock(properties, "yaml")].join("\n\n");
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

function noteNameTable(notes: readonly NoteSample[]): string {
  return table(
    ["Item", "Note name"],
    notes.map(({ sample, noteName }) => [sample.label, code(noteName)]),
  );
}

function citationTable(citations: readonly CitationSample[]): string {
  return table(
    ["Citation", "Main (Enter)", "Alternate (Shift+Enter)"],
    citations.map(({ label, main, alt }) => [label, code(main), code(alt)]),
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

/** An inline code span one backtick longer than any run inside it. */
function code(content: string | null): string {
  if (content === null || content.trim() === "") return "_No output._";
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
  if (content === null || content.trim() === "") return "_No output._";
  const longest = Math.max(
    2,
    ...[...content.matchAll(/`+/g)].map(([run]) => run.length),
  );
  const fence = "`".repeat(longest + 1);
  return `${fence}${language}\n${content.replace(/\n$/, "")}\n${fence}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
