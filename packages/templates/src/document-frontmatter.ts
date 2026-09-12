// The manifest/source split and manifest YAML parse every Template Document parser shares.

import { parseDocument as parseYamlDocument } from "yaml";

export type DocumentSplit =
  | {
      readonly kind: "split";
      readonly manifestSource: string;
      readonly manifestStart: number;
      readonly bodyStart: number;
    }
  | { readonly kind: "no-manifest" }
  | { readonly kind: "unclosed-manifest" };

/**
 * Locate the YAML manifest a document opens with, in UTF-16 offsets, so each
 * parser decides for itself whether a manifest is required and words its own
 * failure.
 *
 * @returns `"no-manifest"` when the first line is not `---`,
 *   `"unclosed-manifest"` when no later `---` line closes it.
 */
export function splitDocumentFrontmatter(source: string): DocumentSplit {
  const firstLineEnd = source.indexOf("\n");
  if (
    firstLineEnd === -1 ||
    trimCarriageReturn(source.slice(0, firstLineEnd)) !== "---"
  ) {
    return { kind: "no-manifest" };
  }

  let lineStart = firstLineEnd + 1;
  while (lineStart <= source.length) {
    const lineEnd = source.indexOf("\n", lineStart);
    const end = lineEnd === -1 ? source.length : lineEnd;
    if (trimCarriageReturn(source.slice(lineStart, end)) === "---") {
      return {
        kind: "split",
        manifestSource: source.slice(firstLineEnd + 1, lineStart),
        manifestStart: firstLineEnd + 1,
        bodyStart: lineEnd === -1 ? source.length : lineEnd + 1,
      };
    }
    if (lineEnd === -1) break;
    lineStart = lineEnd + 1;
  }

  return { kind: "unclosed-manifest" };
}

export function trimCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

/** The first YAML syntax error in a manifest, at its offset in the document. */
export interface ManifestYamlError {
  readonly message: string;
  readonly offset: number;
  readonly cause: unknown;
}

/**
 * Read a manifest's YAML, rejecting duplicate keys, so each parser words its
 * own failure and keeps its own error type.
 *
 * @param start UTF-16 offset of `source` in the whole document, added to the
 *   YAML error position so the reported offset points into the document.
 * @returns the manifest's plain JavaScript form, `undefined` when it is empty.
 * @throws whatever `onSyntaxError` builds for the first YAML syntax error.
 */
export function parseManifestYaml(
  source: string,
  start: number,
  onSyntaxError: (error: ManifestYamlError) => Error,
): unknown {
  const document = parseYamlDocument(source, { uniqueKeys: true });
  const error = document.errors[0];
  if (error) {
    throw onSyntaxError({
      message: error.message,
      offset: start + error.pos[0],
      cause: error,
    });
  }
  return document.toJS();
}
