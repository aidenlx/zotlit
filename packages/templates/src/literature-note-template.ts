// In-memory parsing and validation for one Literature Note Template document.

import * as v from "valibot";
import { parseDocument as parseYamlDocument } from "yaml";

import type { TemplateLanguage } from "./constants";

const OPEN_MANAGED = "{% managed %}";
const CLOSE_MANAGED = "{% endmanaged %}";

const nonEmptyString = v.pipe(v.string(), v.trim(), v.nonEmpty());

const manifestSchema = v.strictObject({
  id: nonEmptyString,
  name: nonEmptyString,
  version: nonEmptyString,
  author: nonEmptyString,
  description: nonEmptyString,
  contract: v.pipe(v.number(), v.integer(), v.minValue(1)),
  minAppVersion: v.optional(nonEmptyString),
  sampleItemType: v.optional(nonEmptyString),
  filename: nonEmptyString,
  profileDefaults: v.optional(
    v.strictObject({
      folder: v.optional(nonEmptyString),
      citationStyle: v.optional(v.nullable(nonEmptyString)),
    }),
    {},
  ),
  language: v.optional(v.picklist(["liquid", "eta"]), "liquid"),
});

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
}

export interface ManagedBlock {
  source: string;
  start: number;
  end: number;
}

export interface LiteratureNoteTemplateDocument {
  manifest: LiteratureNoteTemplateManifest;
  body: string;
  managedBlock: ManagedBlock | null;
}

export type LiteratureNoteTemplateErrorCode =
  | "invalid-document"
  | "invalid-manifest"
  | "frontmatter-not-supported"
  | "invalid-managed-block"
  | "duplicate-managed-block";

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

export function parseLiteratureNoteTemplate(
  source: string,
): LiteratureNoteTemplateDocument {
  const { manifestSource, body } = splitDocument(source);
  const rawManifest = parseManifestYaml(manifestSource);
  if (hasOwn(rawManifest, "frontmatter")) {
    throw new LiteratureNoteTemplateError(
      "frontmatter-not-supported",
      'Manifest field "frontmatter" is reserved and is not supported yet',
      {
        recovery:
          'Remove "frontmatter" until the Managed Frontmatter format is available.',
      },
    );
  }

  const result = v.safeParse(manifestSchema, rawManifest);
  if (!result.success) {
    const issue = result.issues[0]!;
    throw new LiteratureNoteTemplateError(
      "invalid-manifest",
      `Invalid Literature Note Template manifest: ${issue.message}`,
      {
        recovery: "Correct the manifest field named by the validation error.",
        cause: issue,
      },
    );
  }

  return {
    manifest: result.output,
    body,
    managedBlock: findManagedBlock(body, result.output.language),
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
      { recovery: "Keep at most one Managed Block in the document body." },
    );
  }
  if (firstClose === -1) {
    throw new LiteratureNoteTemplateError(
      "invalid-managed-block",
      `${OPEN_MANAGED} block is not closed`,
      { recovery: `Add ${CLOSE_MANAGED} after the Managed Block body.` },
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
      { recovery: "Keep exactly one closing tag for the Managed Block." },
    );
  }

  return {
    source: body.slice(firstOpen + OPEN_MANAGED.length, firstClose),
    start: firstOpen,
    end: firstClose + CLOSE_MANAGED.length,
  };
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
