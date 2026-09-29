// The Template Directory's Markdown editions: the index with every entry's facets, and one edition per entry.
// `src/lib/markdown-routes.ts` owns the URLs; `src/lib/markdown-editions.tsx` serves these beside the content editions.

import { renderToMarkdown } from "fumadocs-core/server";

import { EntryUse } from "@/components/template-directory/entry-use";
import {
  GROUPS,
  KIND_LABEL,
  LEVEL_LABEL,
  valueLabels,
} from "@/components/template-directory/labels";
import { m } from "@/paraglide/messages.js";

import { codeBlock, formatSampleSections } from "./samples-markdown";
import { DIRECTORY_PATH, entryPath } from "./site";
import type { DirectorySite, SiteEntry } from "./site";
import type { EntrySamples } from "./verify";

type Facets = DirectorySite["facets"];

/**
 * The Directory's edition at `slugs` below the index: the index for none, an
 * entry for its `<kind folder>/<slug>` id, and undefined for any other path.
 */
export async function directoryEdition(
  site: DirectorySite,
  slugs: readonly string[],
): Promise<string | undefined> {
  if (slugs.length === 0) return indexEdition(site);
  if (slugs.length !== 2) return undefined;
  const entry = site.entries.find(({ id }) => id === slugs.join("/"));
  return entry && entryEdition(entry, site);
}

/**
 * The Directory's part of `llms.txt`: the index, then every entry under its
 * level, linked to its page as the docs tree links its own.
 */
export function directoryLlmsIndex({ entries }: DirectorySite): string {
  const item = (depth: number, name: string, description: string) =>
    `${"  ".repeat(depth)}- ${name}: ${description}`;
  return [
    item(
      0,
      `[${m.docs_directory_title()}](${DIRECTORY_PATH})`,
      m.docs_directory_description(),
    ),
    ...GROUPS.flatMap(({ level, heading, description }) => {
      const members = entries.filter((entry) => entry.level === level);
      if (members.length === 0) return [];
      return [
        item(1, heading(), description()),
        ...members.map(({ id, title, summary }) =>
          item(2, `[${escapeLinkText(title)}](${entryPath(id)})`, summary),
        ),
      ];
    }),
  ].join("\n");
}

/** The index: the recommended entries, then every entry under its level with its facets. */
function indexEdition({ entries, facets }: DirectorySite): string {
  const recommended = entries.filter(({ recommended }) => recommended);
  const sections = [
    `# ${m.docs_directory_title()} (${DIRECTORY_PATH})`,
    `> ${m.docs_directory_description()}`,
    ...(recommended.length > 0
      ? [
          `## ${m.docs_directory_start_here()}`,
          recommended.map(entryLink).join("\n"),
        ]
      : []),
    ...GROUPS.flatMap(({ level, heading, description }) => {
      const members = entries.filter((entry) => entry.level === level);
      if (members.length === 0) return [];
      return [
        `## ${heading()}`,
        description(),
        members
          .map((entry) =>
            [entryLink(entry), ...indent(facetLines(entry, facets))].join("\n"),
          )
          .join("\n"),
      ];
    }),
  ];
  return `${sections.join("\n\n")}\n`;
}

/**
 * One entry, in the order its page reads: facets, who it is for, the
 * description, the steps, the partials it calls, then the file itself and the
 * samples it renders.
 */
async function entryEdition(
  entry: SiteEntry,
  { entries, facets }: DirectorySite,
): Promise<string> {
  const partials = entry.calls.flatMap((name) =>
    entries.filter(({ id }) => id === `partials/${name}`),
  );
  const sections = [
    `# ${entry.title} (${entryPath(entry.id)})`,
    `> ${entry.summary}`,
    [
      ...facetLines(entry, facets, { level: true }),
      `- ${m.docs_directory_requires({ version: entry.minAppVersion })}`,
    ].join("\n"),
    `**${m.docs_directory_audience()}:** ${entry.audience}`,
    `**${m.docs_directory_effort()}:** ${entry.effort}`,
    entry.description.trim(),
    `## ${m.docs_directory_use_heading()}`,
    await renderToMarkdown(<EntryUse entry={entry} />),
    ...(partials.length > 0
      ? [
          `## ${m.docs_directory_calls_heading()}`,
          entry.kind === "profile"
            ? m.docs_directory_calls_profile()
            : m.docs_directory_calls_recipe(),
          partials.map(entryLink).join("\n"),
        ]
      : []),
    `## ${m.docs_directory_file_heading()}`,
    `\`${entry.file.name}\``,
    codeBlock(entry.file.text, FILE_LANGUAGE[entry.kind]),
    ...samplesSection(entry),
  ];
  return `${sections.join("\n\n")}\n`;
}

/** The fence language of each kind's file. */
const FILE_LANGUAGE = {
  profile: "markdown",
  partial: "markdown",
  citation: "markdown",
  "note-name": "liquid",
  property: "yaml",
} satisfies Record<SiteEntry["kind"], string>;

/** What the entry makes for each Directory Sample, under the page's own intro. */
function samplesSection(entry: SiteEntry): string[] {
  const samples: EntrySamples = {
    notes: entry.notes.map(({ id, label, noteName, frontmatter, body }) => ({
      sample: { id, label },
      noteName,
      properties: frontmatter,
      body,
    })),
    annotations: entry.annotations,
    citations: entry.citations,
  };
  const sections = formatSampleSections(entry.kind, samples, {
    depth: 3,
    leftOut: `_${m.docs_directory_sample_left_out()}_`,
  });
  if (sections.length === 0) return [];
  return [
    `## ${m.docs_directory_samples_heading()}`,
    SAMPLES_INTRO[entry.kind](),
    ...sections,
  ];
}

const SAMPLES_INTRO = {
  profile: m.docs_directory_samples_intro,
  partial: m.docs_directory_samples_intro,
  citation: m.docs_directory_citation_samples_intro,
  "note-name": m.docs_directory_note_name_samples_intro,
  property: m.docs_directory_property_samples_intro,
} satisfies Record<SiteEntry["kind"], () => string>;

/** A list item linking an entry's own edition, with its summary. */
function entryLink({ id, title, summary }: SiteEntry): string {
  return `- [${escapeLinkText(title)}](${entryPath(id)}.md): ${summary}`;
}

/**
 * An entry's facets as list items, each value by the name a reader sees. The
 * index lists entries under their level; an entry's own edition names it.
 */
function facetLines(
  entry: SiteEntry,
  facets: Facets,
  { level = false }: { level?: boolean } = {},
): string[] {
  const itemTypes =
    entry.itemTypes.length > 0
      ? valueLabels("itemType", facets.itemType, entry.itemTypes)
      : [m.docs_directory_any_item_type()];
  const facet = (label: string, values: readonly string[]) =>
    values.length > 0 ? [`- ${label}: ${values.join("; ")}`] : [];
  return [
    ...facet(m.docs_directory_facet_kind(), [KIND_LABEL[entry.kind]()]),
    ...(level
      ? facet(m.docs_directory_facet_level(), [LEVEL_LABEL[entry.level]()])
      : []),
    ...facet(
      m.docs_directory_tasks(),
      valueLabels("task", facets.task, entry.tasks),
    ),
    ...facet(m.docs_directory_item_types(), itemTypes),
    ...facet(
      m.docs_directory_features(),
      valueLabels("feature", facets.feature, entry.features),
    ),
    ...facet(m.docs_directory_keywords(), entry.keywords),
    `- ${m.docs_directory_problems()}:`,
    ...indent(entry.problems.map((problem) => `- ${problem}`)),
  ];
}

function indent(lines: readonly string[]): string[] {
  return lines.map((line) => `  ${line}`);
}

function escapeLinkText(text: string): string {
  return text.replaceAll(/[[\]]/g, "\\$&");
}
