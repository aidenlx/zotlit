// Parser for a plain Template Document: an optional manifest, then one template source.

import * as v from "valibot";

import type { TemplateLanguage } from "./constants";
import {
  parseManifestYaml,
  splitDocumentFrontmatter,
} from "./document-frontmatter";

const manifestSchema = v.strictObject({
  language: v.optional(v.picklist(["liquid", "eta"]), "liquid"),
});

export interface PlainTemplateDocumentManifest {
  readonly language: TemplateLanguage;
}

export interface PlainTemplateDocument {
  readonly manifest: PlainTemplateDocumentManifest;
  /** The template source below the manifest; the whole document when it carries none. */
  readonly source: string;
  /** UTF-16 offset of {@link source} in the original document. */
  readonly sourceStart: number;
}

export type PlainTemplateDocumentErrorCode =
  | "invalid-document"
  | "invalid-manifest";

export class PlainTemplateDocumentError extends Error {
  readonly code: PlainTemplateDocumentErrorCode;
  readonly recovery: string;
  /** UTF-16 offset of the responsible text, so a host can point at it. */
  readonly offset: number;

  constructor(
    code: PlainTemplateDocumentErrorCode,
    message: string,
    {
      recovery,
      offset,
      ...options
    }: ErrorOptions & { recovery: string; offset: number },
  ) {
    super(message, options);
    this.name = "PlainTemplateDocumentError";
    this.code = code;
    this.recovery = recovery;
    this.offset = offset;
  }
}

/**
 * Serialize a plain Template Document — the inverse of
 * {@link parsePlainTemplateDocument}. The manifest is always written, so a
 * `source` that opens with its own `---` line survives the round trip.
 */
export function formatPlainTemplateDocument(
  source: string,
  language: TemplateLanguage,
): string {
  return `---\nlanguage: ${language}\n---\n${source}`;
}

/**
 * Read the Citation Template or a Shared Partial: a document that is one
 * template source, optionally opened by a manifest naming its rendering
 * language. A document with no manifest is Liquid.
 *
 * @throws {@link PlainTemplateDocumentError} when an opened manifest has no
 *   closing fence, holds invalid YAML, or carries a key beyond `language`.
 */
export function parsePlainTemplateDocument(
  source: string,
): PlainTemplateDocument {
  const split = splitDocumentFrontmatter(source);
  if (split.kind === "no-manifest") {
    return {
      manifest: { language: "liquid" },
      source,
      sourceStart: 0,
    };
  }
  if (split.kind === "unclosed-manifest") {
    throw new PlainTemplateDocumentError(
      "invalid-document",
      "Template document manifest is not closed",
      {
        recovery: 'Add a closing "---" line before the template source.',
        offset: source.length,
      },
    );
  }

  const { manifestSource, manifestStart, bodyStart } = split;
  const result = v.safeParse(
    manifestSchema,
    // An empty manifest names no language, which is the Liquid default.
    parseManifestYaml(
      manifestSource,
      manifestStart,
      ({ message, offset, cause }) =>
        new PlainTemplateDocumentError(
          "invalid-manifest",
          `Invalid template document manifest: ${message}`,
          {
            recovery: "Correct the YAML syntax in the manifest.",
            offset,
            cause,
          },
        ),
    ) ?? {},
  );
  if (!result.success) {
    const issue = result.issues[0]!;
    throw new PlainTemplateDocumentError(
      "invalid-manifest",
      `Invalid template document manifest: ${issue.message}`,
      {
        recovery: "Keep 'language: liquid' or 'language: eta' as the only key.",
        offset: manifestStart,
        cause: issue,
      },
    );
  }

  return {
    manifest: result.output,
    source: source.slice(bodyStart),
    sourceStart: bodyStart,
  };
}
