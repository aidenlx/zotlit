// Writes one entry's rendered samples as the Markdown page a reviewer reads beside the entry.

import type { DirectoryEntry } from "./load.ts";
import type { EntrySamples, NoteSample } from "./verify.ts";

/** The command that rewrites every entry's `samples.md` after a change. */
export const UPDATE_SAMPLES_COMMAND =
  "pnpm exec turbo run test --filter=@zotlit/docs -- src/lib/template-directory -u";

export function formatEntrySamples(
  entry: Pick<DirectoryEntry, "title" | "kind">,
  { notes, annotations }: EntrySamples,
): string {
  const sections = [
    `<!-- Written by the Template Directory verification suite; do not edit. Update with: ${UPDATE_SAMPLES_COMMAND} -->`,
    `# Rendered samples: ${entry.title}`,
    ...notes.map((note) => noteSection(note, entry.kind)),
  ];
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
