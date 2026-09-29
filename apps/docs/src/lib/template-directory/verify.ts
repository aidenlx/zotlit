// Verifies every Directory Entry: its invariants, and a clean render over every Directory Sample and Sample Annotation.

import { isDeepStrictEqual } from "node:util";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import {
  hasSuffixMarker,
  inlineCitation,
  replaceSuffixMarkers,
} from "@zotlit/templates";
import builtInCitation from "@zotlit/templates/defaults/citation.liquid?raw";
import {
  parseLiteratureNoteTemplate,
  TemplateFacade,
} from "@zotlit/templates/facade";
import type { ManagedFrontmatterEntry } from "@zotlit/templates/facade";
import { compileFilter } from "@zotlit/workbench/match";
import type { MatchCondition } from "@zotlit/workbench/match";
import {
  citationExampleData,
  renderProfile,
  restoreTemplateData,
  SAMPLE_ANNOTATIONS,
  SAMPLE_ITEMS,
  sampleItemCitation,
} from "@zotlit/workbench/render";
import type {
  AnnotationExample,
  CitationExampleId,
  RenderDiagnostic,
  RenderedProperty,
  RenderResources,
  TemplateRenderResult,
} from "@zotlit/workbench/render";

import { ITEM_TYPES } from "./entry.ts";
import {
  CONTRACT_VERSION,
  harnessProfile,
  loadTemplateDirectory,
} from "./load.ts";
import type { DirectoryEntry, DirectoryFiles } from "./load.ts";
import type { DirectoryProblem, DirectoryProblemCode } from "./problem.ts";
import {
  COLOR_HIGHLIGHTS,
  DIRECTORY_SAMPLES,
  EDGE_SAMPLES,
  EVERY_COLOR_SAMPLE,
  TODO_HIGHLIGHT,
} from "./samples.ts";
import type { DirectorySample } from "./samples.ts";

/** One Directory Sample's note, as the entry renders it. */
export interface NoteSample {
  readonly sample: Pick<DirectorySample, "id" | "label">;
  /** The note name; null for an entry that names no note. */
  readonly noteName: string | null;
  /** The properties as the note's YAML block; null when it writes none. */
  readonly properties: string | null;
  /** The note body; null for an entry that writes no body. */
  readonly body: string | null;
}

/** One Sample Annotation, as the entry's Annotation Section renders it. */
export interface AnnotationSample {
  readonly id: string;
  readonly label: string;
  readonly output: string | null;
}

/** One Citation, as a citation text entry renders it under each Citation Variant. */
export interface CitationSample {
  readonly label: string;
  readonly main: string | null;
  readonly alt: string | null;
}

export interface EntrySamples {
  readonly notes: readonly NoteSample[];
  readonly annotations: readonly AnnotationSample[];
  /** Citation text entries only: every Citation the entry renders. */
  readonly citations?: readonly CitationSample[];
}

export interface DirectoryVerification {
  readonly entries: readonly DirectoryEntry[];
  readonly problems: readonly DirectoryProblem[];
  /** Rendered samples by entry id. */
  readonly samples: ReadonlyMap<string, EntrySamples>;
}

/** The reader-facing command that rewrites every packed partial. */
export const REPACK_COMMAND =
  "pnpm exec turbo run template-directory:repack --filter=@zotlit/docs";

/** The Sample Item Sample Annotations belong to. */
const ANNOTATED_ITEM = SAMPLE_ITEMS[1]!;

const PROFILE_ID = /^[A-Za-z0-9]{12}$/;

/** Manifest keys that bind a Profile to one vault's folders or citation style. */
const BINDING_KEYS = [
  "folder",
  "importFolder",
  "citationStyle",
  "importColoredHighlights",
  "importAnnotationsAsTemplate",
] as const;

/** Manifest keys every Profile entry states for the reader. */
const REQUIRED_PROFILE_KEYS = [
  "author",
  "description",
  "sampleItemType",
  "minAppVersion",
] as const;

/**
 * Load the Directory, check every entry, and render it over every Directory
 * Sample and Sample Annotation. An entry that renders keeps its samples even
 * when it breaks a rule, so a failing check can be read beside its output.
 */
export function verifyTemplateDirectory(
  files: DirectoryFiles,
): DirectoryVerification {
  const { entries, problems: loadProblems } = loadTemplateDirectory(files);
  const partials = new Map(
    entries.flatMap((entry) =>
      entry.kind === "partial" ? [[entry.slug, entry] as const] : [],
    ),
  );
  const resources: RenderResources = {
    dependencies: {
      templates: [...partials.values()].map(({ slug, language, source }) => ({
        name: slug,
        language: language as "liquid",
        source,
      })),
      diagnostics: [],
    },
    citationStyle: { kind: "default" },
  };
  const problems: DirectoryProblem[] = [...loadProblems];
  const samples = new Map<string, EntrySamples>();
  for (const entry of entries) {
    const report = (code: DirectoryProblemCode, message: string) =>
      problems.push({ entry: entry.id, code, message });
    for (const name of entry.calls) {
      if (!partials.has(name)) {
        report(
          "unknown-partial",
          `It calls the partial "${name}", which no partial entry holds. Every partial a Directory Entry calls is itself a partial entry, so one name means one source.`,
        );
      }
    }
    switch (entry.kind) {
      case "profile":
        checkProfile(entry, partials, report);
        samples.set(entry.id, renderProfileEntry(entry, report));
        break;
      case "partial":
        checkLanguage(entry.language, report);
        if (entry.context === "citation") {
          report(
            "unverified",
            "The verification renders no citation-context partial yet. Add its verification before the first entry of this kind ships.",
          );
          break;
        }
        samples.set(entry.id, renderPartialEntry(entry, resources, report));
        break;
      case "property":
        samples.set(entry.id, renderPropertyEntry(entry, report));
        break;
      case "citation":
        checkLanguage(entry.language, report);
        samples.set(entry.id, renderCitationEntry(entry, resources, report));
        break;
      case "note-name":
        samples.set(entry.id, renderNoteNameEntry(entry, resources, report));
        break;
    }
  }
  problems.push(...duplicateProfileIds(entries));
  return { entries, problems, samples };
}

type Report = (code: DirectoryProblemCode, message: string) => void;
type ProfileEntry = Extract<DirectoryEntry, { kind: "profile" }>;
type PartialEntry = Extract<DirectoryEntry, { kind: "partial" }>;
type PropertyEntry = Extract<DirectoryEntry, { kind: "property" }>;
type CitationEntry = Extract<DirectoryEntry, { kind: "citation" }>;
type NoteNameEntry = Extract<DirectoryEntry, { kind: "note-name" }>;

function checkProfile(
  { manifest, calls, artifact }: ProfileEntry,
  partials: ReadonlyMap<string, PartialEntry>,
  report: Report,
): void {
  if (!PROFILE_ID.test(manifest.id) || manifest.id === "default") {
    report(
      "profile-id",
      `The Profile ID "${manifest.id}" must be twelve letters and digits, minted once for the entry and kept across editions.`,
    );
  }
  const bindings = BINDING_KEYS.filter((key) => manifest[key] !== undefined);
  if (bindings.length > 0) {
    report(
      "profile-binding",
      `The manifest binds ${bindings.join(", ")}. A Directory Profile leaves folders, citation style, and Imported Note settings to the reader's vault.`,
    );
  }
  if (manifest.match !== undefined) {
    const matchProblem = itemTypeMatchProblem(manifest.match);
    if (matchProblem) report("profile-match", matchProblem);
  }
  if (manifest.contract !== CONTRACT_VERSION) {
    report(
      "profile-contract",
      `The manifest states contract ${manifest.contract}; the current template contract is ${CONTRACT_VERSION}.`,
    );
  }
  const missing = REQUIRED_PROFILE_KEYS.filter(
    (key) => manifest[key] === undefined,
  );
  if (missing.length > 0) {
    report(
      "profile-metadata",
      `The manifest needs ${missing.join(", ")}, which the import sheet and the Directory show the reader.`,
    );
  }
  if (
    manifest.sampleItemType !== undefined &&
    !ITEM_TYPES.includes(manifest.sampleItemType)
  ) {
    report(
      "profile-metadata",
      `sampleItemType "${manifest.sampleItemType}" is not a Zotero item type.`,
    );
  }
  checkLanguage(manifest.language, report);
  for (const partial of manifest.partials ?? []) {
    checkLanguage(
      partial.language,
      report,
      `The packed partial "${partial.name}"`,
    );
  }
  (manifest.frontmatter ?? []).forEach((property, index) => {
    if (!("value" in property)) {
      report(
        "property-language",
        `Property ${property.key ?? `#${index + 1}`} is not a JSON-e rule. Every Directory property is written as "Rule · JSON-e", the manifest's \`value\` member.`,
      );
    }
  });
  checkManagedBlock(artifact.source, report);
  checkPackedPartials({ manifest, calls }, partials, report);
}

function checkLanguage(
  language: string,
  report: Report,
  subject = "The template",
): void {
  if (language !== "liquid") {
    report(
      "template-language",
      `${subject} is written in ${language}. Directory Entries are Liquid only.`,
    );
  }
}

/**
 * The title heading a note may open with, outside the Managed Block: the note
 * gets it once, when it is created, and the `title` property keeps the
 * current title.
 */
const TITLE_HEADING = "# {{ zt.title }}\n";

/**
 * Everything from Zotero sits inside the one Managed Block, so an update never
 * rewrites what the reader wrote: the text around the block is the reader's,
 * and holds no template code but a first-line title heading.
 */
function checkManagedBlock(source: string, report: Report): void {
  const { body, managedBlock } = parseLiteratureNoteTemplate(source);
  if (managedBlock === null) {
    report(
      "managed-block",
      "The note body has no Managed Block. Everything that comes from Zotero belongs inside {% managed %} … {% endmanaged %}.",
    );
    return;
  }
  const before = body.slice(0, managedBlock.start);
  const outside =
    (before.startsWith(TITLE_HEADING)
      ? before.slice(TITLE_HEADING.length)
      : before) + body.slice(managedBlock.end);
  if (/\{\{|\{%/.test(outside)) {
    report(
      "managed-block",
      "Template code sits outside the Managed Block, where an update would never refresh it. Move it inside {% managed %} … {% endmanaged %}; the text around the block is the reader's. Only a first-line title heading, # {{ zt.title }}, may stay outside.",
    );
  }
}

function checkPackedPartials(
  { manifest, calls }: Pick<ProfileEntry, "manifest" | "calls">,
  partials: ReadonlyMap<string, PartialEntry>,
  report: Report,
): void {
  const packed = manifest.partials ?? [];
  const packedByName = new Map(
    packed.map((partial) => [partial.name, partial]),
  );
  for (const name of calls) {
    const entry = partials.get(name);
    if (entry === undefined) continue;
    const copy = packedByName.get(name);
    if (copy === undefined) {
      report(
        "partial-not-packed",
        `It calls the partial "${name}" but does not pack it. Run \`${REPACK_COMMAND}\`.`,
      );
    } else if (
      copy.source !== entry.source ||
      copy.language !== entry.language
    ) {
      report(
        "packed-partial-differs",
        `Its packed "${name}" differs from the partial entry of that name. Run \`${REPACK_COMMAND}\`.`,
      );
    }
  }
  for (const { name } of packed) {
    if (!calls.includes(name)) {
      report(
        "packed-partial-uncalled",
        `It packs the partial "${name}", which nothing in the Profile calls. Run \`${REPACK_COMMAND}\`.`,
      );
    }
  }
}

/** Why a Profile Match is not portable, or null when it tests built-in item types alone. */
function itemTypeMatchProblem(
  match: Parameters<typeof compileFilter>[0],
): string | null {
  const compiled = compileFilter(match);
  if (compiled.problem) {
    return `The match does not compile (${compiled.problem.code}: "${compiled.problem.text}").`;
  }
  const leaves: MatchCondition[] = [];
  const visit = (condition: MatchCondition): boolean => {
    if (condition.kind !== "group") {
      leaves.push(condition);
      return true;
    }
    return condition.conditions.length > 0 && condition.conditions.every(visit);
  };
  if (!visit(compiled.condition)) {
    return "The match holds an empty group. A Directory Profile matches named item types or nothing.";
  }
  const other = leaves.filter(
    (leaf) => leaf.kind !== "item-type" || leaf.negated,
  );
  return other.length === 0
    ? null
    : `The match tests ${other.map((leaf) => (leaf.kind === "item-type" ? "an excluded item type" : leaf.kind)).join(", ")}. A Directory Profile matches by built-in item type only, so it selects the same items in every vault.`;
}

function duplicateProfileIds(
  entries: readonly DirectoryEntry[],
): DirectoryProblem[] {
  const byId = new Map<string, string[]>();
  for (const entry of entries) {
    if (entry.kind !== "profile") continue;
    byId.set(entry.manifest.id, [
      ...(byId.get(entry.manifest.id) ?? []),
      entry.id,
    ]);
  }
  return [...byId].flatMap(([id, holders]) =>
    holders.length < 2
      ? []
      : holders.map((holder) => ({
          entry: holder,
          code: "duplicate-profile-id" as const,
          message: `The Profile ID "${id}" is also used by ${holders.filter((other) => other !== holder).join(", ")}. Mint a new ID for a new Profile entry.`,
        })),
  );
}

/**
 * The Sample Annotations; for an entry that shows highlight colors, a
 * highlight in every other Zotero color and a custom color; and for an entry
 * that makes tasks, a highlight whose comment starts with "todo".
 */
function sampleAnnotations(
  features: DirectoryEntry["features"],
): readonly AnnotationExample[] {
  return [
    ...SAMPLE_ANNOTATIONS,
    ...(features.includes("color-highlights") ? COLOR_HIGHLIGHTS : []),
    ...(features.includes("tasks") ? [TODO_HIGHLIGHT] : []),
  ];
}

/**
 * The Directory Samples, and for an entry that groups annotations by color, a
 * note with an annotation in every color.
 */
function noteSamples(
  features: DirectoryEntry["features"],
): readonly DirectorySample[] {
  return features.includes("grouped-by-color")
    ? [...DIRECTORY_SAMPLES, EVERY_COLOR_SAMPLE]
    : DIRECTORY_SAMPLES;
}

function renderProfileEntry(
  { artifact, manifest, features }: ProfileEntry,
  report: Report,
): EntrySamples {
  const notes = noteSamples(features).map((sample) => {
    const result = renderProfile(artifact.source, sample.snapshot);
    reportDiagnostics(result, sample.label, report);
    checkProperties(
      { fold: result.fold, frontmatter: manifest.frontmatter ?? [] },
      sample.label,
      report,
    );
    return noteSample(sample, result, result.creationBody);
  });
  const annotations = sampleAnnotations(features).map((annotation) => {
    const result = renderProfile(artifact.source, ANNOTATED_ITEM, {
      annotation,
    });
    reportDiagnostics(result, annotationLabel(annotation.root), report);
    return {
      id: annotation.id,
      label: annotationLabel(annotation.root),
      output: result.annotation,
    };
  });
  return { notes, annotations };
}

/**
 * The Annotation Section a `note` partial's samples render annotations with:
 * one line naming each annotation's type, color, page, and text or comment,
 * so a sample shows where every annotation lands.
 */
const NAMED_ANNOTATION =
  "- {{ zt.type }} annotation" +
  "{% if zt.colorName %}, {{ zt.colorName }}{% elsif zt.colorHex %}, custom color {{ zt.colorHex }}{% endif %}" +
  "{% if zt.pageLabel %}, p. {{ zt.pageLabel }}{% endif %}" +
  "{% if zt.text %}: {{ zt.text }}{% elsif zt.comment %}: {{ zt.comment }}{% endif %}\n";

function renderPartialEntry(
  { slug, context, call: statedCall, features }: PartialEntry,
  resources: RenderResources,
  report: Report,
): EntrySamples {
  const call = `${statedCall ?? `{% render "${slug}" with zt as zt -%}`}\n`;
  if (context === "annotation") {
    const source = harnessProfile({ annotation: call });
    return {
      notes: [],
      annotations: sampleAnnotations(features).map((annotation) => {
        const result = renderProfile(source, ANNOTATED_ITEM, {
          annotation,
          resources: withBuiltInCitation(resources),
        });
        reportDiagnostics(result, annotationLabel(annotation.root), report);
        return {
          id: annotation.id,
          label: annotationLabel(annotation.root),
          output: result.annotation,
        };
      }),
    };
  }
  const source = harnessProfile({
    body: `{% managed %}\n${call}{% endmanaged %}\n`,
    annotation: NAMED_ANNOTATION,
  });
  return {
    notes: noteSamples(features).map((sample) => {
      const result = renderProfile(source, sample.snapshot, { resources });
      reportDiagnostics(result, sample.label, report);
      return {
        sample: { id: sample.id, label: sample.label },
        noteName: null,
        properties: null,
        body: withoutManagedMarkers(result.managedRegion),
      };
    }),
    annotations: [],
  };
}

/**
 * The resources with ZotLit's built-in Citation Template, which an annotation
 * inserted on its own renders its `zt.citation` through until a reader
 * replaces it. In a literature note, `zt.citation` stays empty.
 */
function withBuiltInCitation(resources: RenderResources): RenderResources {
  return {
    ...resources,
    dependencies: {
      ...resources.dependencies,
      templates: [
        ...resources.dependencies.templates,
        { name: "citation", language: "liquid", source: builtInCitation },
      ],
    },
  };
}

function renderPropertyEntry(
  { property, expected }: PropertyEntry,
  report: Report,
): EntrySamples {
  if (!("value" in property)) {
    report(
      "property-language",
      'The property is not a JSON-e rule. Every Directory property is written as "Rule · JSON-e", the `value` member.',
    );
  }
  const source = harnessProfile({ frontmatter: [property] });
  for (const id of Object.keys(expected)) {
    if (!DIRECTORY_SAMPLES.some((sample) => sample.id === id)) {
      report(
        "property-expectation",
        `expected names "${id}", which is not a Directory Sample.`,
      );
    }
  }
  return {
    notes: DIRECTORY_SAMPLES.map((sample) => {
      const result = renderProfile(source, sample.snapshot);
      reportDiagnostics(result, sample.label, report);
      checkProperties(
        { fold: result.fold, frontmatter: [property] },
        sample.label,
        report,
      );
      const produced = Object.fromEntries(
        result.fold.flatMap(({ key, value, missing }) =>
          missing ? [] : [[key, value]],
        ),
      );
      const wanted = expected[sample.id];
      if (wanted !== undefined && !isDeepStrictEqual(produced, wanted)) {
        report(
          "property-expectation",
          `For the ${sample.label} it writes ${JSON.stringify(produced)}; the entry states ${JSON.stringify(wanted)}.`,
        );
      }
      return {
        sample: { id: sample.id, label: sample.label },
        noteName: null,
        properties: propertiesBlock(result.fold),
        body: null,
      };
    }),
    annotations: [],
  };
}

/** The name a Citation Template renders under, in the plugin and here. */
const CITATION_TEMPLATE = "citation";

/**
 * A template engine holding every Liquid partial entry, as a reader's template
 * folder would. A partial that fails to parse is left out: its own entry
 * reports the failure, and a call to it reports a missing partial.
 */
function facadeWithPartials(resources: RenderResources): TemplateFacade {
  const facade = new TemplateFacade();
  for (const { name, source, language } of resources.dependencies.templates) {
    if (language !== "liquid") continue;
    try {
      facade.define(name, source, language);
    } catch {
      // Reported by the partial entry itself.
    }
  }
  return facade;
}

/**
 * The Citations a citation text renders beyond each Directory Sample cited
 * alone: the Workbench example sets, which carry two items, a page, a
 * suppressed author, a prefix and a suffix, and an annotation's page.
 */
const CITATION_SETS: readonly (readonly [CitationExampleId, string])[] = [
  ["two-items", "Journal article and book"],
  ["item-with-page", "Journal article, pages 12-14"],
  ["suppressed-author", "Journal article, author left out"],
  ["prefix-and-suffix", "Journal article, with text before and after"],
  ["annotation-citation", "Journal article, page 1, as an annotation cites it"],
];

type CitationData = ReturnType<typeof citationExampleData>;

/**
 * Render a citation text the way the plugin inserts it: through the
 * Citation Template, collapsed to one line, under both Citation Variants.
 */
function renderCitationEntry(
  { source, language }: CitationEntry,
  resources: RenderResources,
  report: Report,
): EntrySamples {
  const facade = facadeWithPartials(resources);
  try {
    facade.define(CITATION_TEMPLATE, source, language);
  } catch (error) {
    report(
      "render-diagnostic",
      `The citation text does not parse: ${errorText(error)}`,
    );
    return { notes: [], annotations: [], citations: [] };
  }
  const render = (label: string, data: CitationData): string | null => {
    try {
      const text = inlineCitation(facade.render(CITATION_TEMPLATE, data));
      for (const fault of valueFaults(text)) {
        report(
          "citation-output",
          `The ${label} citation under the ${data.variant} variant ${fault}.`,
        );
      }
      return text;
    } catch (error) {
      report(
        "render-diagnostic",
        `Rendering the ${label} citation under the ${data.variant} variant reports ${errorText(error)}`,
      );
      return null;
    }
  };
  const cited: readonly {
    label: string;
    data: (variant: CitationData["variant"]) => CitationData;
  }[] = [
    ...[...DIRECTORY_SAMPLES, ...EDGE_SAMPLES].map(({ label, snapshot }) => ({
      label,
      data: (variant: CitationData["variant"]) =>
        sampleItemCitation(snapshot, variant),
    })),
    ...CITATION_SETS.map(([id, label]) => ({
      label,
      data: (variant: CitationData["variant"]) =>
        citationExampleData(id, variant),
    })),
  ];
  return {
    notes: [],
    annotations: [],
    citations: cited.map(({ label, data }) => ({
      label,
      main: render(label, data("main")),
      alt: render(label, data("alt")),
    })),
  };
}

/**
 * Render a Filename Template the way the plugin names a new note, over every
 * Directory Sample and Edge Sample: the name with its collision suffix left
 * empty, as a note gets it when no other note holds that name.
 */
function renderNoteNameEntry(
  { source }: NoteNameEntry,
  resources: RenderResources,
  report: Report,
): EntrySamples {
  const document = parseLiteratureNoteTemplate(
    harnessProfile({ filename: source }),
  );
  const facade = facadeWithPartials(resources);
  return {
    notes: [...DIRECTORY_SAMPLES, ...EDGE_SAMPLES].map(
      ({ id, label, snapshot }) => {
        let noteName: string | null = null;
        try {
          const rendered = facade.renderLiteratureNoteTemplateFilename(
            document,
            restoreTemplateData(
              snapshot.roots.filename,
              snapshot.descriptors.filename,
            ),
          );
          if (!hasSuffixMarker(rendered)) {
            report(
              "note-name-suffix",
              `The note name of the ${label} holds no {% suffix %}, so a second note with that name would fail to be created. End the note name with {% suffix %}.`,
            );
          }
          noteName = replaceSuffixMarkers(rendered, () => "");
          for (const fault of noteNameFaults(noteName)) {
            report(
              "note-name-output",
              `For the ${label}, the note name ${fault}.`,
            );
          }
        } catch (error) {
          report(
            "render-diagnostic",
            `Rendering the note name of the ${label} reports ${errorText(error)}`,
          );
        }
        return {
          sample: { id, label },
          noteName,
          properties: null,
          body: null,
        };
      },
    ),
    annotations: [],
  };
}

/**
 * Characters a file name cannot hold where Obsidian stores a note: a slash
 * makes a folder, and Obsidian changes each of the others to "_".
 * @see apps/obsidian/src/services/note-feature/filename.ts FORBIDDEN_CHARS
 */
const NOT_IN_FILE_NAME = /[\\/:*?"<>|#^[\]]/g;
const CONTROL_CHARACTER = /\p{Cc}/u;

/** Why a rendered note name is not one file name, exactly as the samples show it. */
function noteNameFaults(name: string): string[] {
  if (name.trim() === "") return ["is empty"];
  const faults: string[] = [];
  if (CONTROL_CHARACTER.test(name)) {
    faults.push(
      `holds a line break or another control character: ${JSON.stringify(name)}`,
    );
  }
  const forbidden = [...new Set(name.match(NOT_IN_FILE_NAME))];
  if (forbidden.length > 0) {
    faults.push(
      `holds ${forbidden.join(" ")}, which a file name cannot hold: "${name}"`,
    );
  }
  if (name !== name.trim()) {
    faults.push(`starts or ends with a space: "${name}"`);
  }
  if (name.endsWith(".")) {
    faults.push(
      `ends with a dot, which Obsidian removes from a file name: "${name}"`,
    );
  }
  return faults;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function reportDiagnostics(
  result: TemplateRenderResult,
  subject: string,
  report: Report,
): void {
  for (const diagnostic of result.diagnostics) {
    report(
      "render-diagnostic",
      `Rendering the ${subject} reports ${describeDiagnostic(diagnostic)}.`,
    );
  }
}

function describeDiagnostic(diagnostic: RenderDiagnostic): string {
  const detail = diagnostic.message ?? JSON.stringify(diagnostic.params ?? {});
  return `${diagnostic.code} in the ${diagnostic.part}: ${detail}`;
}

/**
 * Property output the reader sees as broken: null or empty values, the words
 * "null" or "undefined" in text, and separators with nothing on one side. A
 * null under "Keep the existing value" is an empty property the reader fills
 * in, such as a rating, so it is not broken.
 */
function checkProperties(
  {
    fold,
    frontmatter,
  }: {
    readonly fold: readonly RenderedProperty[];
    /** The entries that produced `fold`, which name each property's merge. */
    readonly frontmatter: readonly ManagedFrontmatterEntry[];
  },
  subject: string,
  report: Report,
): void {
  const present = fold.filter(({ missing }) => !missing);
  for (const { key, value, position } of present) {
    if (value === null && frontmatter[position - 1]?.merge === "keep") {
      continue;
    }
    for (const fault of valueFaults(value)) {
      report(
        "property-output",
        `For the ${subject}, property "${key}" ${fault}.`,
      );
    }
  }
}

const SEPARATORS = ",;:·|/–—-";
const LITERAL_EMPTY = /\b(?:null|undefined|NaN)\b/;
/** Two separators with nothing between them, such as ", ," or ". .". */
const DOUBLED_SEPARATOR = /[,;:·|]\s*[,;:·|.]|\.\s+\./;
const EMPTY_BRACKETS = /\(\s*\)|\[\s*\]/;
/**
 * A volume, issue, or page label whose number is missing, such as "Vol." or
 * "№ ,". A label's own dot is never read as the separator after it, so
 * "Vol. 5" and "p. 12" pass.
 */
const LABEL_WITHOUT_VALUE =
  /(?:^|[\s(])(?:[Vv]ol|[Nn]o|[Ii]ss|pp?|№)(?:\.\s*(?:$|[,;:.)])|\s*(?:$|[,;:)])|\s+\.)/;

function valueFaults(value: unknown): string[] {
  if (value === null || value === undefined) return ["is null"];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      valueFaults(item).map((fault) => `item ${index + 1} ${fault}`),
    );
  }
  if (typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) =>
      valueFaults(item).map((fault) => `"${key}" ${fault}`),
    );
  }
  if (typeof value !== "string") return [];
  const text = value.trim();
  if (text === "") return ["is empty text"];
  const faults: string[] = [];
  if (LITERAL_EMPTY.test(text)) faults.push(`reads "${text}"`);
  if (
    SEPARATORS.includes(text[0]!) ||
    SEPARATORS.includes(text.at(-1)!) ||
    DOUBLED_SEPARATOR.test(text) ||
    EMPTY_BRACKETS.test(text) ||
    LABEL_WITHOUT_VALUE.test(text)
  ) {
    faults.push(`has a separator with nothing beside it: "${text}"`);
  }
  return faults;
}

function noteSample(
  sample: DirectorySample,
  result: TemplateRenderResult,
  body: string | null,
): NoteSample {
  // The YAML block is parsed back, so a property that breaks YAML is caught
  // here rather than in the reader's note.
  const properties = propertiesBlock(result.fold);
  if (properties !== null) parseYaml(properties);
  return {
    sample: { id: sample.id, label: sample.label },
    noteName: result.filename,
    properties,
    body,
  };
}

/**
 * The properties as Obsidian writes them into the note, with the options of
 * its `stringifyYaml`: an empty property reads `rating:`, not `rating: null`.
 */
function propertiesBlock(fold: readonly RenderedProperty[]): string | null {
  const present = fold.filter(({ missing }) => !missing);
  if (present.length === 0) return null;
  return stringifyYaml(
    Object.fromEntries(present.map(({ key, value }) => [key, value])),
    { nullStr: "", lineWidth: 0, aliasDuplicateObjects: false },
  );
}

function withoutManagedMarkers(region: string | null): string | null {
  if (region === null) return null;
  return region.split("\n").slice(1, -1).join("\n");
}

function annotationLabel(root: Record<string, unknown>): string {
  const color =
    typeof root.colorName === "string"
      ? `, ${root.colorName}`
      : typeof root.colorHex === "string"
        ? `, custom color ${root.colorHex}`
        : "";
  return `${String(root.type)} annotation${color}`;
}
