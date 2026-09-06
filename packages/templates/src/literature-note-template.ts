// In-memory parsing and validation for one Literature Note Template document.

import annotationEta from "@defaults/annotation.eta?raw";
import annotationLiquid from "@defaults/annotation.liquid?raw";
import * as v from "valibot";
import {
  parseDocument as parseYamlDocument,
  stringify as stringifyYaml,
} from "yaml";

import {
  ANNOTATION_HEADER,
  frontmatterMergeStrategySchema,
  MANAGED_BLOCK_TAG_NAMES,
  RESERVED_FRONTMATTER_KEYS,
} from "./constants";
import type { FrontmatterField, TemplateLanguage } from "./constants";

const [MANAGED_OPEN_TAG, MANAGED_CLOSE_TAG] = MANAGED_BLOCK_TAG_NAMES;
const OPEN_MANAGED = `{% ${MANAGED_OPEN_TAG} %}`;
const CLOSE_MANAGED = `{% ${MANAGED_CLOSE_TAG} %}`;

const nonEmptyString = v.pipe(v.string(), v.trim(), v.nonEmpty());
const nonEmptyTemplateSource = v.pipe(
  v.string(),
  v.check((source) => source.trim().length > 0, "Empty template source"),
);

const partialSchema = v.strictObject({
  name: nonEmptyString,
  language: v.picklist(["liquid", "eta"]),
  source: nonEmptyTemplateSource,
});

const partialsSchema = v.pipe(
  v.array(partialSchema),
  v.checkItems(
    (partial, index, partials) =>
      partials.findIndex(({ name }) => name === partial.name) === index,
    "Duplicate partial name",
  ),
  v.readonly(),
);

const managedFrontmatterEntryBase = {
  key: v.optional(nonEmptyString),
  merge: v.optional(frontmatterMergeStrategySchema, "replace"),
};

const managedFrontmatterEntrySchema = v.pipe(
  v.union([
    v.strictObject({
      ...managedFrontmatterEntryBase,
      key: nonEmptyString,
      expr: v.string(),
    }),
    v.strictObject({ ...managedFrontmatterEntryBase, value: v.unknown() }),
    v.strictObject({ ...managedFrontmatterEntryBase, js: v.string() }),
  ]),
  v.check(
    ({ key }) => key === undefined || !RESERVED_FRONTMATTER_KEYS.has(key),
    ({ input }) => `Managed Frontmatter key '${input.key}' is reserved`,
  ),
);

const managedFrontmatterSchema = v.pipe(
  v.array(managedFrontmatterEntrySchema),
  v.checkItems(
    (entry, index, entries) =>
      entry.key === undefined ||
      entries.findIndex(({ key }) => key === entry.key) === index,
    ({ input }) => `Duplicate Managed Frontmatter key '${input.key}'`,
  ),
  v.readonly(),
);

const profileBindingEntries = {
  folder: v.optional(v.string()),
  citationStyle: v.optional(v.nullable(nonEmptyString)),
  importFolder: v.optional(v.string()),
  importColoredHighlights: v.optional(v.boolean()),
  importAnnotationsAsTemplate: v.optional(v.boolean()),
};

/** An empty `and` matches every Item; an empty `or` matches none. */
export type MatchTree =
  | string
  | { readonly and: readonly MatchTree[] }
  | { readonly or: readonly MatchTree[] };

export const matchTreeSchema: v.GenericSchema<MatchTree> = v.union([
  v.string(),
  v.strictObject({ and: v.array(v.lazy(() => matchTreeSchema)) }),
  v.strictObject({ or: v.array(v.lazy(() => matchTreeSchema)) }),
]);

const manifestSchema = v.pipe(
  v.strictObject({
    id: nonEmptyString,
    name: nonEmptyString,
    version: nonEmptyString,
    author: v.optional(nonEmptyString),
    description: v.optional(nonEmptyString),
    contract: v.pipe(v.number(), v.integer(), v.minValue(1)),
    minAppVersion: v.optional(nonEmptyString),
    sampleItemType: v.optional(nonEmptyString),
    filename: nonEmptyTemplateSource,
    match: v.optional(matchTreeSchema),
    ...profileBindingEntries,
    language: v.optional(v.picklist(["liquid", "eta"]), "liquid"),
    partials: v.optional(partialsSchema),
    frontmatter: v.optional(managedFrontmatterSchema),
  }),
  v.check(
    (manifest) =>
      manifest.id !== "default" ||
      Object.keys(profileBindingEntries).every((key) => !(key in manifest)),
    "Default Profile bindings belong in settings",
  ),
  v.forward(
    v.check(
      (manifest) => manifest.id !== "default" || !("match" in manifest),
      "Default Profile carries no match",
    ),
    ["match"],
  ),
);

export type ManagedFrontmatterEntry = v.InferOutput<
  typeof managedFrontmatterEntrySchema
>;

export interface LiteratureNoteTemplatePartial {
  readonly name: string;
  readonly language: TemplateLanguage;
  readonly source: string;
}

export interface LiteratureNoteTemplateManifest {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  contract: number;
  minAppVersion?: string;
  sampleItemType?: string;
  filename: string;
  match?: MatchTree;
  folder?: string;
  citationStyle?: string | null;
  importFolder?: string;
  importColoredHighlights?: boolean;
  importAnnotationsAsTemplate?: boolean;
  language: TemplateLanguage;
  partials?: readonly LiteratureNoteTemplatePartial[];
  frontmatter?: readonly ManagedFrontmatterEntry[];
}

export interface ManagedBlock {
  source: string;
  start: number;
  end: number;
  /**
   * The line break a line-owning close tag took with it, or the empty string.
   * The Managed Block is replaced rather than removed, so the create path puts
   * this back after the Managed Region to terminate the region's last line.
   */
  trailingLineBreak: string;
}

export interface AnnotationSection {
  source: string;
  /** UTF-16 offsets into the original document; end is exclusive. */
  start: number;
  end: number;
  headerStart: number;
}

export interface LiteratureNoteTemplateDocument {
  manifest: LiteratureNoteTemplateManifest;
  body: string;
  /** Offset of the implicit note source in the original document. */
  bodyStart: number;
  managedBlock: ManagedBlock | null;
  annotationSection: AnnotationSection;
}

export interface LegacyLiteratureNoteTemplates {
  readonly note: {
    readonly source: string;
    readonly language: TemplateLanguage;
  };
  readonly content: {
    readonly source: string;
    readonly language: TemplateLanguage;
  };
  readonly filename: {
    readonly source: string;
    readonly language: TemplateLanguage;
  };
  readonly annotation?: {
    readonly source: string;
    readonly language: TemplateLanguage;
  };
}

export type LegacyTemplateConversionErrorCode =
  | "unsupported-legacy-template"
  | "legacy-render-mismatch"
  | "legacy-frontmatter-inert"
  | "legacy-frontmatter-evaluation";

export class LegacyTemplateConversionError extends Error {
  readonly code: LegacyTemplateConversionErrorCode;
  readonly difference: string;
  readonly recovery: string;
  readonly fields: readonly string[] | undefined;

  constructor(
    code: LegacyTemplateConversionErrorCode,
    message: string,
    options: ErrorOptions & {
      difference: string;
      recovery: string;
      fields?: readonly string[];
    },
  ) {
    const { difference, fields, recovery, ...errorOptions } = options;
    super(message, errorOptions);
    this.name = "LegacyTemplateConversionError";
    this.code = code;
    this.difference = difference;
    this.recovery = recovery;
    this.fields = fields;
  }
}

export const CONVERTED_DEFAULT_PROFILE_DOCUMENT = "zotlit-profile.default.md";

export interface SynthesizedLiteratureNoteTemplateManifest {
  readonly id?: string;
  readonly name?: string;
  readonly description?: string;
  readonly frontmatter?: readonly FrontmatterField[];
}

/** Map legacy settings fields without parsing or rewriting their expressions. */
export function convertLegacyFrontmatterFields(
  fields: readonly FrontmatterField[],
): ManagedFrontmatterEntry[] {
  return fields.map(({ key, expr, merge, language }) =>
    language === "liquid" ? { key, expr, merge } : { key, js: expr, merge },
  );
}

/** Synthesize one document from the three legacy Literature Note slots. */
export function synthesizeLegacyLiteratureNoteTemplate(
  legacy: LegacyLiteratureNoteTemplates,
  manifestOverrides: SynthesizedLiteratureNoteTemplateManifest = {},
): string {
  const language = legacy.note.language;
  if (
    legacy.content.language !== language ||
    legacy.filename.language !== language ||
    (legacy.annotation !== undefined && legacy.annotation.language !== language)
  ) {
    throw new LegacyTemplateConversionError(
      "unsupported-legacy-template",
      "Legacy Literature Note templates use different languages",
      {
        difference: "template language",
        recovery:
          "Use one rendering language for the note, content, filename, and annotation templates, then retry conversion.",
      },
    );
  }

  const insertion =
    language === "liquid"
      ? '{% render "content" with zt as zt %}'
      : '<%~ include("content", zt) %>';
  if (countOccurrences(legacy.note.source, insertion) !== 1) {
    throw new LegacyTemplateConversionError(
      "unsupported-legacy-template",
      "Legacy note template must contain one supported content insertion",
      {
        difference: "content insertion",
        recovery:
          "Keep one standard content render in the legacy note template, then retry conversion.",
      },
    );
  }

  const annotationSource =
    legacy.annotation?.source ??
    (language === "liquid" ? annotationLiquid : annotationEta);
  // An indented insertion keeps the glued open tag: a line-owning open tag would
  // take the author's indentation with it and lose those bytes.
  const insertionIndex = legacy.note.source.indexOf(insertion);
  const openManaged =
    insertionIndex === 0 || legacy.note.source[insertionIndex - 1] === "\n"
      ? "{% managed %}\n"
      : "{% managed %}";
  const body = `${legacy.note.source.replace(
    insertion,
    () => `${openManaged}${legacy.content.source}{% endmanaged %}`,
  )}\n${ANNOTATION_HEADER}\n${annotationSource}`;
  const manifest = stringifyYaml(
    {
      id: manifestOverrides.id ?? "default",
      name: manifestOverrides.name ?? "Converted default",
      version: "1.0.0",
      author: "ZotLit",
      description:
        manifestOverrides.description ??
        "Converted from legacy Literature Note Templates.",
      contract: 2,
      filename: legacy.filename.source,
      language,
      ...(manifestOverrides.frontmatter === undefined
        ? {}
        : {
            frontmatter: convertLegacyFrontmatterFields(
              manifestOverrides.frontmatter,
            ),
          }),
    },
    { lineWidth: 0 },
  );
  return `---\n${manifest}---\n${body}`;
}

function countOccurrences(source: string, value: string): number {
  let count = 0;
  let from = 0;
  while (from <= source.length) {
    const index = source.indexOf(value, from);
    if (index === -1) return count;
    count += 1;
    from = index + value.length;
  }
  return count;
}

export type LiteratureNoteTemplateErrorCode =
  | "invalid-document"
  | "invalid-manifest"
  | "invalid-managed-block"
  | "duplicate-managed-block"
  | "unknown-section-header"
  | "duplicate-annotation-section"
  | "missing-annotation-section"
  | "reserved-annotation-partial";

export class LiteratureNoteTemplateError extends Error {
  readonly code: LiteratureNoteTemplateErrorCode;
  readonly recovery: string;
  /** Readable manifest identity for diagnostics, even when the document is invalid. */
  readonly manifestId?: string;
  /** UTF-16 offset of the responsible text, so a host can point at it. */
  readonly offset?: number;
  /**
   * Path of the responsible manifest node, so a host that reads the manifest
   * YAML can point at the field itself rather than the manifest's first line.
   */
  readonly manifestPath?: readonly (string | number)[];

  constructor(
    code: LiteratureNoteTemplateErrorCode,
    message: string,
    {
      recovery,
      manifestId,
      offset,
      manifestPath,
      ...options
    }: ErrorOptions & {
      recovery: string;
      manifestId?: string;
      offset?: number;
      manifestPath?: readonly (string | number)[];
    },
  ) {
    super(message, options);
    this.name = "LiteratureNoteTemplateError";
    this.code = code;
    this.recovery = recovery;
    this.manifestId = manifestId;
    this.offset = offset;
    this.manifestPath = manifestPath;
  }
}

export function parseLiteratureNoteTemplate(
  source: string,
): LiteratureNoteTemplateDocument {
  const { manifestSource, manifestStart, bodyStart } = splitDocument(source);
  const rawManifest = parseManifestYaml(manifestSource, manifestStart);

  try {
    const result = v.safeParse(manifestSchema, rawManifest);
    if (!result.success) {
      const issue = result.issues[0]!;
      const frontmatter = frontmatterIssueContext(rawManifest, issue);
      throw new LiteratureNoteTemplateError(
        "invalid-manifest",
        frontmatter?.entry
          ? `Invalid Managed Frontmatter entry ${frontmatter.entry}: ${issue.message}`
          : frontmatter
            ? `Invalid Literature Note Template manifest field 'frontmatter': ${issue.message}`
            : `Invalid Literature Note Template manifest: ${issue.message}`,
        {
          recovery: frontmatter?.entry
            ? "Correct the named Managed Frontmatter entry."
            : frontmatter
              ? "Correct the Managed Frontmatter section."
              : "Correct the manifest field named by the validation error.",
          offset: manifestStart,
          manifestPath: manifestNodePath(issue),
          cause: issue,
        },
      );
    }

    const reserved = result.output.partials?.findIndex(
      ({ name }) => name === "annotation",
    );
    if (reserved !== undefined && reserved !== -1) {
      throw new LiteratureNoteTemplateError(
        "reserved-annotation-partial",
        "The partial name 'annotation' is reserved for the Annotation Section",
        {
          recovery:
            "Rename the manifest partial named 'annotation' and update its calls.",
          offset: manifestStart,
          manifestPath: ["partials", reserved, "name"],
        },
      );
    }
    const annotationSection = findAnnotationSection(source, bodyStart);
    const body = source.slice(bodyStart, annotationSection.headerStart);

    return {
      manifest: result.output,
      body,
      bodyStart,
      managedBlock: findManagedBlock(body, result.output.language, bodyStart),
      annotationSection,
    };
  } catch (error) {
    if (!(error instanceof LiteratureNoteTemplateError)) throw error;
    const id = readOwn(rawManifest, "id");
    throw new LiteratureNoteTemplateError(error.code, error.message, {
      recovery: error.recovery,
      manifestId: typeof id === "string" ? id : undefined,
      offset: error.offset,
      manifestPath: error.manifestPath,
      cause: error,
    });
  }
}

/**
 * The manifest node a validation issue is about, in the shape a YAML lookup
 * takes. An issue that names no node keeps the whole manifest as its subject.
 */
function manifestNodePath(issue: {
  path?: readonly { key: unknown }[];
}): readonly (string | number)[] | undefined {
  const path = issue.path?.map(({ key }) => key) ?? [];
  return path.length > 0 &&
    path.every((key) => typeof key === "string" || typeof key === "number")
    ? (path as readonly (string | number)[])
    : undefined;
}

function frontmatterIssueContext(
  rawManifest: unknown,
  issue: { path?: readonly { key: unknown }[] },
): { entry?: string } | null {
  const frontmatterPath = issue.path?.findIndex(
    ({ key }) => key === "frontmatter",
  );
  if (frontmatterPath === undefined || frontmatterPath === -1) return null;
  const index = issue.path
    ?.slice(frontmatterPath + 1)
    .find(({ key }) => typeof key === "number")?.key;
  if (typeof index !== "number") return {};

  const entries = readOwn(rawManifest, "frontmatter");
  if (!Array.isArray(entries)) return {};
  const key = readOwn(entries[index], "key");
  return {
    entry:
      typeof key === "string" && key.trim() !== ""
        ? `'${key.trim()}'`
        : `#${index + 1}`,
  };
}

function splitDocument(source: string): {
  manifestSource: string;
  manifestStart: number;
  bodyStart: number;
} {
  const firstLineEnd = source.indexOf("\n");
  if (
    firstLineEnd === -1 ||
    trimCarriageReturn(source.slice(0, firstLineEnd)) !== "---"
  ) {
    throw new LiteratureNoteTemplateError(
      "invalid-document",
      "Literature Note Template document must start with manifest frontmatter",
      {
        recovery:
          'Add a YAML manifest between opening and closing "---" lines.',
        offset: 0,
      },
    );
  }

  let lineStart = firstLineEnd + 1;
  while (lineStart <= source.length) {
    const lineEnd = source.indexOf("\n", lineStart);
    const end = lineEnd === -1 ? source.length : lineEnd;
    if (trimCarriageReturn(source.slice(lineStart, end)) === "---") {
      return {
        manifestSource: source.slice(firstLineEnd + 1, lineStart),
        manifestStart: firstLineEnd + 1,
        bodyStart: lineEnd === -1 ? source.length : lineEnd + 1,
      };
    }
    if (lineEnd === -1) break;
    lineStart = lineEnd + 1;
  }

  throw new LiteratureNoteTemplateError(
    "invalid-document",
    "Literature Note Template manifest is not closed",
    {
      recovery: 'Add a closing "---" line before the template body.',
      offset: source.length,
    },
  );
}

/**
 * UTF-16 offsets of the manifest YAML between the document's two fence lines,
 * so a host can patch one manifest node in place instead of re-serializing the
 * whole manifest.
 * @throws LiteratureNoteTemplateError when the document carries no closed manifest.
 */
export function literatureNoteTemplateManifestRange(source: string): {
  from: number;
  to: number;
} {
  const { manifestSource, manifestStart } = splitDocument(source);
  return { from: manifestStart, to: manifestStart + manifestSource.length };
}

function parseManifestYaml(source: string, start: number): unknown {
  const document = parseYamlDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    const error = document.errors[0]!;
    throw new LiteratureNoteTemplateError(
      "invalid-manifest",
      `Invalid Literature Note Template manifest: ${error.message}`,
      {
        recovery: "Correct the YAML syntax in the manifest.",
        offset: start + error.pos[0],
        cause: error,
      },
    );
  }
  return document.toJS();
}

/** The document boundary is independent of Markdown and template syntax. */
function findAnnotationSection(
  source: string,
  bodyStart: number,
): AnnotationSection {
  let section: AnnotationSection | undefined;
  let lineStart = bodyStart;
  while (lineStart <= source.length) {
    const lineEnd = source.indexOf("\n", lineStart);
    const end = lineEnd === -1 ? source.length : lineEnd;
    const rawLine = source.slice(lineStart, end);
    const line = lineEnd === -1 ? rawLine : trimCarriageReturn(rawLine);
    if (line.startsWith("--- zotlit:")) {
      if (line !== ANNOTATION_HEADER) {
        throw new LiteratureNoteTemplateError(
          "unknown-section-header",
          `Unknown Profile section header at line ${lineAt(source, lineStart)}: ${line}`,
          {
            recovery: `Use only the exact standalone ${ANNOTATION_HEADER} header; the note source starts after the manifest.`,
            offset: lineStart,
          },
        );
      }
      if (section) {
        throw new LiteratureNoteTemplateError(
          "duplicate-annotation-section",
          `Duplicate Annotation Section at line ${lineAt(source, lineStart)}`,
          {
            recovery: `Keep one ${ANNOTATION_HEADER} header, followed by the annotation source through the end of the document.`,
            offset: lineStart,
          },
        );
      }
      const start = lineEnd === -1 ? source.length : lineEnd + 1;
      section = {
        source: source.slice(start),
        start,
        end: source.length,
        headerStart: lineStart,
      };
    }
    if (lineEnd === -1) break;
    lineStart = lineEnd + 1;
  }
  if (!section) {
    throw new LiteratureNoteTemplateError(
      "missing-annotation-section",
      `Literature Note Template document has no ${ANNOTATION_HEADER} header`,
      {
        recovery: `Add one standalone ${ANNOTATION_HEADER} line after the note source. The annotation source extends to the end of the document and can be empty.`,
        offset: source.length,
      },
    );
  }
  return section;
}

function findManagedBlock(
  body: string,
  language: TemplateLanguage,
  bodyStart: number,
): ManagedBlock | null {
  const literalRanges =
    language === "liquid" ? findLiquidLiteralRanges(body) : [];
  const firstOpen = findFormatTag(body, OPEN_MANAGED, { literalRanges });
  const firstClose = findFormatTag(body, CLOSE_MANAGED, { literalRanges });
  if (firstOpen === -1 && firstClose === -1) return null;
  if (firstOpen === -1 || (firstClose !== -1 && firstClose < firstOpen)) {
    throw new LiteratureNoteTemplateError(
      "invalid-managed-block",
      `Unexpected ${CLOSE_MANAGED} tag`,
      {
        recovery: `Remove the unmatched tag or add ${OPEN_MANAGED} before it.`,
        offset: bodyStart + firstClose,
      },
    );
  }

  const secondOpen = findFormatTag(body, OPEN_MANAGED, {
    from: firstOpen + OPEN_MANAGED.length,
    literalRanges,
  });
  if (secondOpen !== -1) {
    throw new LiteratureNoteTemplateError(
      "duplicate-managed-block",
      `Duplicate ${OPEN_MANAGED} block at line ${lineAt(body, secondOpen)}`,
      {
        recovery: "Keep at most one Managed Block in the document body.",
        offset: bodyStart + secondOpen,
      },
    );
  }
  if (firstClose === -1) {
    throw new LiteratureNoteTemplateError(
      "invalid-managed-block",
      `${OPEN_MANAGED} block is not closed`,
      {
        recovery: `Add ${CLOSE_MANAGED} after the Managed Block body.`,
        offset: bodyStart + firstOpen,
      },
    );
  }

  const extraClose = findFormatTag(body, CLOSE_MANAGED, {
    from: firstClose + CLOSE_MANAGED.length,
    literalRanges,
  });
  if (extraClose !== -1) {
    throw new LiteratureNoteTemplateError(
      "invalid-managed-block",
      `Unexpected ${CLOSE_MANAGED} tag at line ${lineAt(body, extraClose)}`,
      {
        recovery: "Keep exactly one closing tag for the Managed Block.",
        offset: bodyStart + extraClose,
      },
    );
  }

  const afterOpen = firstOpen + OPEN_MANAGED.length;
  const afterClose = firstClose + CLOSE_MANAGED.length;
  const openOwnsLine = tagOwnsLine(body, firstOpen, afterOpen);
  const closeOwnsLine = tagOwnsLine(body, firstClose, afterClose);
  const trailingLineBreak = closeOwnsLine
    ? body.slice(afterClose, afterClose + lineBreakLength(body, afterClose))
    : "";

  return {
    source: body.slice(
      afterOpen + (openOwnsLine ? lineBreakLength(body, afterOpen) : 0),
      closeOwnsLine ? lineStartIndex(body, firstClose) : firstClose,
    ),
    start: openOwnsLine ? lineStartIndex(body, firstOpen) : firstOpen,
    end: afterClose + trailingLineBreak.length,
    trailingLineBreak,
  };
}

/** @returns the index just after the line break preceding `index`. */
function lineStartIndex(body: string, index: number): number {
  return body.lastIndexOf("\n", index - 1) + 1;
}

/** @returns the length of the line break at `index`, or 0 when none starts there. */
function lineBreakLength(body: string, index: number): number {
  if (body.startsWith("\r\n", index)) return 2;
  return body[index] === "\n" ? 1 : 0;
}

/**
 * A Line-Owning Tag's indentation and trailing line break belong to the tag, so
 * they leave the block source and travel with the block when it is removed.
 *
 * @returns true when only whitespace stands between the line start and the tag,
 * and a line break (or the document end) follows it.
 * @see docs/adr/0028-structural-block-tags-trim-by-line-ownership.md
 */
function tagOwnsLine(body: string, start: number, end: number): boolean {
  if (!/^[ \t]*$/.test(body.slice(lineStartIndex(body, start), start))) {
    return false;
  }
  return end === body.length || lineBreakLength(body, end) > 0;
}

interface SourceRange {
  start: number;
  end: number;
}

function findLiquidLiteralRanges(source: string): SourceRange[] {
  const blocks = [
    { open: "{% raw %}", close: "{% endraw %}" },
    { open: "{% comment %}", close: "{% endcomment %}" },
  ];
  const ranges: SourceRange[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    let next: { open: string; close: string; start: number } | undefined;
    for (const block of blocks) {
      const start = source.indexOf(block.open, cursor);
      if (start !== -1 && (!next || start < next.start)) {
        next = { ...block, start };
      }
    }
    if (!next) break;

    const close = source.indexOf(next.close, next.start + next.open.length);
    const end = close === -1 ? source.length : close + next.close.length;
    ranges.push({ start: next.start, end });
    cursor = end;
  }

  return ranges;
}

function findFormatTag(
  source: string,
  tag: string,
  {
    from = 0,
    literalRanges,
  }: { from?: number; literalRanges: readonly SourceRange[] },
): number {
  let index = source.indexOf(tag, from);
  while (index !== -1) {
    const range = literalRanges.find(
      (candidate) => candidate.start <= index && index < candidate.end,
    );
    if (!range) return index;
    index = source.indexOf(tag, range.end);
  }
  return -1;
}

function lineAt(source: string, index: number): number {
  let line = 1;
  for (let offset = 0; offset < index; offset += 1) {
    if (source[offset] === "\n") line += 1;
  }
  return line;
}

function trimCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

function hasOwn(value: unknown, key: string): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.prototype.hasOwnProperty.call(value, key)
  );
}

function readOwn(value: unknown, key: string): unknown {
  return hasOwn(value, key)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}
