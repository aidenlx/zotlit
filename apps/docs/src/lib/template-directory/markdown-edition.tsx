// The Template Directory's Markdown editions: the index with every entry's facets, and one edition per entry.
// `src/lib/markdown-routes.ts` owns the URLs; `src/lib/markdown-editions.tsx` serves these beside the content editions.

import { renderToMarkdown } from "fumadocs-core/server";

import {
  EntryChanges,
  EntryUse,
} from "@/components/template-directory/entry-use";
import {
  colorKeyText,
  GROUPS,
  KIND_LABEL,
  LEVEL_LABEL,
  SAMPLE_LABELS,
  valueLabels,
} from "@/components/template-directory/labels";
import { m } from "@/paraglide/messages.js";

import { codeBlock, formatSampleSections } from "./samples-markdown";
import { calledPartials, DIRECTORY_PATH, entryId, entryPath } from "./site";
import type { DirectorySite, SiteEntry } from "./site";
import type { EntrySamples } from "./verify";

/**
 * The Directory's edition at `slugs` below the index: the index for none, an
 * entry for its `<kind folder>/<slug>` id, and undefined for any other path.
 */
export async function directoryEdition(
  site: DirectorySite,
  slugs: readonly string[],
): Promise<string | undefined> {
  if (slugs.length === 0) return indexEdition(site);
  const [folder, slug, ...rest] = slugs;
  if (folder === undefined || slug === undefined || rest.length > 0) {
    return undefined;
  }
  const entry = site.entries.find(({ id }) => id === entryId(folder, slug));
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
function indexEdition({ entries }: DirectorySite): string {
  const recommended = entries.filter(({ recommended }) => recommended);
  const sections = [
    `# ${m.docs_directory_title()} (${DIRECTORY_PATH})`,
    `> ${m.docs_directory_description()}`,
    ...(recommended.length > 0
      ? [
          `## ${m.docs_directory_recommended()}`,
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
            [entryLink(entry), ...indent(facetLines(entry))].join("\n"),
          )
          .join("\n"),
      ];
    }),
  ];
  return `${sections.join("\n\n")}\n`;
}

/**
 * One entry, in the order its page reads. A Profile reads as its page does:
 * facets, the steps, the color key, the example it makes, then the Details,
 * and the Source last. A part reads: facets, the result for each example
 * item, the look it changes and the steps, the partials it needs, the Details,
 * and the Source last.
 */
async function entryEdition(
  entry: SiteEntry,
  { entries }: DirectorySite,
): Promise<string> {
  const partials = calledPartials(entries, entry.calls);
  const head = [
    `# ${entry.title} (${entryPath(entry.id)})`,
    `> ${entry.summary}`,
    [
      ...facetLines(entry, { level: true }),
      `- ${m.docs_directory_requires({ version: entry.minAppVersion })}`,
    ].join("\n"),
    `**${m.docs_directory_audience()}:** ${entry.audience}`,
    `**${m.docs_directory_effort()}:** ${entry.effort}`,
  ];
  const description = entry.description.trim();
  const steps = [
    `## ${m.docs_directory_use_heading()}`,
    ...(entry.kind === "profile"
      ? []
      : [(await renderToMarkdown(<EntryChanges entry={entry} />)).trim()]),
    await renderToMarkdown(<EntryUse entry={entry} />),
  ];
  const sections =
    entry.kind === "profile"
      ? [
          ...head,
          ...steps,
          ...colorKeySection(entry),
          ...samplesSection(entry),
          `## ${m.docs_directory_details_heading()}`,
          description,
          ...sourceSection(entry, entries),
        ]
      : [
          ...head,
          ...samplesSection(entry),
          ...steps,
          ...(partials.length > 0
            ? [
                `## ${m.docs_directory_calls_heading()}`,
                m.docs_directory_calls_recipe(),
                partials.map(entryLink).join("\n"),
              ]
            : []),
          `## ${m.docs_directory_details_heading()}`,
          description,
          ...sourceSection(entry, entries),
        ];
  return `${sections.join("\n\n")}\n`;
}

/**
 * The final Source section, where the page folds it. A Profile gives the
 * note part, the partials its file packs, and the whole file; any other
 * entry gives its own file.
 */
function sourceSection(
  entry: SiteEntry,
  entries: readonly SiteEntry[],
): string[] {
  const heading = `## ${m.docs_directory_source_heading()}`;
  const file = [
    `\`${entry.file.name}\``,
    codeBlock(entry.file.text, FILE_LANGUAGE[entry.kind]),
  ];
  const { profileSource } = entry;
  if (profileSource === null) {
    return [
      heading,
      ...file,
      ...(entry.details.kind === "partial"
        ? [
            m.docs_directory_partial_file(),
            `### ${m.docs_directory_source_call()}`,
            codeBlock(entry.details.call, "liquid"),
          ]
        : []),
    ];
  }
  return [
    heading,
    m.docs_directory_source_profile_hint({
      import: `**${m.docs_directory_import()}**`,
    }),
    `### ${m.docs_directory_source_note_part()}`,
    codeBlock(profileSource.note, FILE_LANGUAGE[entry.kind]),
    ...(profileSource.partials.length > 0
      ? [
          `### ${m.docs_directory_calls_heading()}`,
          m.docs_directory_calls_profile(),
          profileSource.partials
            .map(({ name, id }) => {
              const partial = entries.find((candidate) => candidate.id === id);
              return partial ? entryLink(partial) : `- ${name}`;
            })
            .join("\n"),
        ]
      : []),
    `### ${m.docs_directory_source_whole_file()}`,
    ...file,
  ];
}

/** The color key of a Profile that gives colors meanings, with the link to change them. */
function colorKeySection({ colorKey }: SiteEntry): string[] {
  if (colorKey === null) return [];
  return [
    `## ${m.docs_directory_color_key_heading()}`,
    colorKey.rows.map((row) => `- ${colorKeyText(row)}`).join("\n"),
    ...(colorKey.changeWith === null
      ? []
      : [
          `[${m.docs_directory_color_key_change()}](${entryPath(colorKey.changeWith)}.md)`,
        ]),
  ];
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
    notes: entry.notes.map(({ id, noteName, frontmatter, body }) => ({
      sample: { id },
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
    labels: SAMPLE_LABELS,
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
  { level = false }: { level?: boolean } = {},
): string[] {
  const itemTypes =
    entry.itemTypes.length > 0
      ? valueLabels("itemType", entry.itemTypes)
      : [m.docs_directory_any_item_type()];
  const facet = (label: string, values: readonly string[]) =>
    values.length > 0 ? [`- ${label}: ${values.join("; ")}`] : [];
  return [
    ...facet(m.docs_directory_facet_kind(), [KIND_LABEL[entry.kind]()]),
    ...(level
      ? facet(m.docs_directory_facet_level(), [LEVEL_LABEL[entry.level]()])
      : []),
    ...facet(m.docs_directory_tasks(), valueLabels("task", entry.tasks)),
    ...facet(m.docs_directory_item_types(), itemTypes),
    ...facet(
      m.docs_directory_features(),
      valueLabels("feature", entry.features),
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
