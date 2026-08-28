// In-memory parsing and validation for one Literature Note Template document.

import annotationEta from "@defaults/annotation.eta?raw";
import annotationLiquid from "@defaults/annotation.liquid?raw";
import * as v from "valibot";
import {
  parseDocument as parseYamlDocument,
  stringify as stringifyYaml,
} from "yaml";

import {
  frontmatterMergeStrategySchema,
  RESERVED_FRONTMATTER_KEYS,
} from "./constants";
import type { FrontmatterField, TemplateLanguage } from "./constants";

const OPEN_MANAGED = "{% managed %}";
const CLOSE_MANAGED = "{% endmanaged %}";
const OPEN_ANNOTATION = "{% annotation %}";
const CLOSE_ANNOTATION = "{% endannotation %}";

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
  key: nonEmptyString,
  merge: v.optional(frontmatterMergeStrategySchema, "replace"),
};

const managedFrontmatterEntrySchema = v.pipe(
  v.union([
    v.strictObject({ ...managedFrontmatterEntryBase, expr: v.string() }),
    v.strictObject({ ...managedFrontmatterEntryBase, value: v.unknown() }),
    v.strictObject({ ...managedFrontmatterEntryBase, js: v.string() }),
  ]),
  v.check(
    ({ key }) => !RESERVED_FRONTMATTER_KEYS.has(key),
    ({ input }) => `Managed Frontmatter key '${input.key}' is reserved`,
  ),
);

const managedFrontmatterSchema = v.pipe(
  v.array(managedFrontmatterEntrySchema),
  v.checkItems(
    (entry, index, entries) =>
      entries.findIndex(({ key }) => key === entry.key) === index,
    ({ input }) => `Duplicate Managed Frontmatter key '${input.key}'`,
  ),
  v.readonly(),
);

const manifestSchema = v.strictObject({
  id: nonEmptyString,
  name: nonEmptyString,
  version: nonEmptyString,
  author: nonEmptyString,
  description: nonEmptyString,
  contract: v.pipe(v.number(), v.integer(), v.minValue(1)),
  minAppVersion: v.optional(nonEmptyString),
  sampleItemType: v.optional(nonEmptyString),
  filename: nonEmptyTemplateSource,
  profileDefaults: v.optional(
    v.strictObject({
      folder: v.optional(nonEmptyString),
      citationStyle: v.optional(v.nullable(nonEmptyString)),
    }),
    {},
  ),
  language: v.optional(v.picklist(["liquid", "eta"]), "liquid"),
  partials: v.optional(partialsSchema),
  frontmatter: v.optional(managedFrontmatterSchema),
});

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
  author: string;
  description: string;
  contract: number;
  minAppVersion?: string;
  sampleItemType?: string;
  filename: string;
  profileDefaults: {
    folder?: string;
    citationStyle?: string | null;
  };
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

export interface AnnotationBlock {
  source: string;
  start: number;
  end: number;
}

export interface LiteratureNoteTemplateDocument {
  manifest: LiteratureNoteTemplateManifest;
  body: string;
  managedBlock: ManagedBlock | null;
  annotationBlock: AnnotationBlock | null;
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

export const CONVERTED_DEFAULT_PROFILE_DOCUMENT = "literature-note-default.md";

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
  // Both blocks are written as Line-Owning Tags, so a converted document reads
  // as blocks while rendering the same bytes the legacy slots rendered. An
  // indented insertion keeps the glued open tag: a line-owning open tag would
  // take the author's indentation with it and lose those bytes.
  const insertionIndex = legacy.note.source.indexOf(insertion);
  const openManaged =
    insertionIndex === 0 || legacy.note.source[insertionIndex - 1] === "\n"
      ? "{% managed %}\n"
      : "{% managed %}";
  const body = `${legacy.note.source.replace(
    insertion,
    () => `${openManaged}${legacy.content.source}{% endmanaged %}`,
  )}\n{% annotation %}\n${annotationSource}{% endannotation %}\n`;
  const manifest = stringifyYaml(
    {
      id: manifestOverrides.id ?? "zotlit.converted-default",
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
  | "invalid-annotation-block"
  | "duplicate-annotation-block"
  | "missing-annotation-block";

export class LiteratureNoteTemplateError extends Error {
  readonly code: LiteratureNoteTemplateErrorCode;
  readonly recovery: string;

  constructor(
    code: LiteratureNoteTemplateErrorCode,
    message: string,
    { recovery, ...options }: ErrorOptions & { recovery: string },
  ) {
    super(message, options);
    this.name = "LiteratureNoteTemplateError";
    this.code = code;
    this.recovery = recovery;
  }
}

export function missingAnnotationBlockError(): LiteratureNoteTemplateError {
  return new LiteratureNoteTemplateError(
    "missing-annotation-block",
    `Literature Note Template document has no ${OPEN_ANNOTATION} block`,
    {
      recovery: `Add one ${OPEN_ANNOTATION} ... ${CLOSE_ANNOTATION} block to the document body, with each tag alone on its line.`,
    },
  );
}

export function parseLiteratureNoteTemplate(
  source: string,
): LiteratureNoteTemplateDocument {
  const { manifestSource, body } = splitDocument(source);
  const rawManifest = parseManifestYaml(manifestSource);

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
        cause: issue,
      },
    );
  }

  const annotationBlock = findAnnotationBlock(body, result.output.language);
  if (!annotationBlock) {
    throw missingAnnotationBlockError();
  }

  return {
    manifest: result.output,
    body,
    managedBlock: findManagedBlock(body, result.output.language),
    annotationBlock,
  };
}

/** Return a render-only document whose Annotation Block contributes no bytes. */
export function withoutAnnotationBlock(
  document: LiteratureNoteTemplateDocument,
): LiteratureNoteTemplateDocument {
  if (!document.annotationBlock) return document;
  const { start, end } = document.annotationBlock;
  const body = document.body.slice(0, start) + document.body.slice(end);
  return {
    ...document,
    body,
    managedBlock: findManagedBlock(body, document.manifest.language),
    annotationBlock: null,
  };
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
  body: string;
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
        body: lineEnd === -1 ? "" : source.slice(lineEnd + 1),
      };
    }
    if (lineEnd === -1) break;
    lineStart = lineEnd + 1;
  }

  throw new LiteratureNoteTemplateError(
    "invalid-document",
    "Literature Note Template manifest is not closed",
    { recovery: 'Add a closing "---" line before the template body.' },
  );
}

function parseManifestYaml(source: string): unknown {
  const document = parseYamlDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    const error = document.errors[0]!;
    throw new LiteratureNoteTemplateError(
      "invalid-manifest",
      `Invalid Literature Note Template manifest: ${error.message}`,
      { recovery: "Correct the YAML syntax in the manifest.", cause: error },
    );
  }
  return document.toJS();
}

function findManagedBlock(
  body: string,
  language: TemplateLanguage,
): ManagedBlock | null {
  return findTemplateBlock(body, language, {
    open: OPEN_MANAGED,
    close: CLOSE_MANAGED,
    invalidCode: "invalid-managed-block",
    duplicateCode: "duplicate-managed-block",
    label: "Managed Block",
  });
}

function findAnnotationBlock(
  body: string,
  language: TemplateLanguage,
): AnnotationBlock | null {
  return findTemplateBlock(body, language, {
    open: OPEN_ANNOTATION,
    close: CLOSE_ANNOTATION,
    invalidCode: "invalid-annotation-block",
    duplicateCode: "duplicate-annotation-block",
    label: "Annotation Block",
  });
}

function findTemplateBlock(
  body: string,
  language: TemplateLanguage,
  options: {
    open: string;
    close: string;
    invalidCode: Extract<
      LiteratureNoteTemplateErrorCode,
      "invalid-managed-block" | "invalid-annotation-block"
    >;
    duplicateCode: Extract<
      LiteratureNoteTemplateErrorCode,
      "duplicate-managed-block" | "duplicate-annotation-block"
    >;
    label: string;
  },
): ManagedBlock | null {
  const { open, close, invalidCode, duplicateCode, label } = options;
  const literalRanges =
    language === "liquid" ? findLiquidLiteralRanges(body) : [];
  const firstOpen = findFormatTag(body, open, { literalRanges });
  const firstClose = findFormatTag(body, close, { literalRanges });
  if (firstOpen === -1 && firstClose === -1) return null;
  if (firstOpen === -1 || (firstClose !== -1 && firstClose < firstOpen)) {
    throw new LiteratureNoteTemplateError(
      invalidCode,
      `Unexpected ${close} tag`,
      {
        recovery: `Remove the unmatched tag or add ${open} before it.`,
      },
    );
  }

  const secondOpen = findFormatTag(body, open, {
    from: firstOpen + open.length,
    literalRanges,
  });
  if (secondOpen !== -1) {
    throw new LiteratureNoteTemplateError(
      duplicateCode,
      `Duplicate ${open} block at line ${lineAt(body, secondOpen)}`,
      { recovery: `Keep at most one ${label} in the document body.` },
    );
  }
  if (firstClose === -1) {
    throw new LiteratureNoteTemplateError(
      invalidCode,
      `${open} block is not closed`,
      { recovery: `Add ${close} after the ${label} body.` },
    );
  }

  const extraClose = findFormatTag(body, close, {
    from: firstClose + close.length,
    literalRanges,
  });
  if (extraClose !== -1) {
    throw new LiteratureNoteTemplateError(
      invalidCode,
      `Unexpected ${close} tag at line ${lineAt(body, extraClose)}`,
      { recovery: `Keep exactly one closing tag for the ${label}.` },
    );
  }

  const afterOpen = firstOpen + open.length;
  const afterClose = firstClose + close.length;
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
