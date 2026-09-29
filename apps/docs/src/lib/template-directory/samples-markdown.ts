// Writes one entry's rendered samples as the Markdown page a reviewer reads beside the entry.

import type { DirectoryEntry } from "./load.ts";
import type { CitationSample, EntrySamples, NoteSample } from "./verify.ts";

/** The command that rewrites every entry's `samples.md` after a change. */
export const UPDATE_SAMPLES_COMMAND =
  "pnpm exec turbo run test --filter=@zotlit/docs -- src/lib/template-directory -u";

export function formatEntrySamples(
  entry: Pick<DirectoryEntry, "title" | "kind">,
  { notes, annotations, citations = [] }: EntrySamples,
): string {
  const sections = [
    `<!-- Written by the Template Directory verification suite; do not edit. Update with: ${UPDATE_SAMPLES_COMMAND} -->`,
    `# Rendered samples: ${entry.title}`,
    ...(entry.kind === "note-name"
      ? [noteNameTable(notes)]
      : notes.map((note) => noteSection(note, entry.kind))),
  ];
  if (citations.length > 0) sections.push(citationTable(citations));
  if (annotations.length > 0) {
    sections.push(
      "## Annotation Section",
      ...annotations.map(({ label, output }) =>
        [`### ${capitalize(label)}`, block(output, "markdown")].join("\n\n"),
      ),
    );
  }
  return `${sections.join("\n\n")}\n`;
}

function noteSection(
  { sample, noteName, properties, body }: NoteSample,
  kind: DirectoryEntry["kind"],
): string {
  const heading = `## ${sample.label}`;
  if (kind === "property")
    return [heading, block(properties, "yaml")].join("\n\n");
  if (kind !== "profile")
    return [heading, block(body, "markdown")].join("\n\n");
  const note =
    body === null
      ? null
      : properties === null
        ? body
        : `---\n${properties}---\n${body}`;
  return [
    heading,
    `Note name: \`${noteName ?? "(none)"}\``,
    block(note, "markdown"),
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
function block(content: string | null, language: string): string {
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
