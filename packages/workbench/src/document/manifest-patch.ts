// Targeted YAML edits into the Profile manifest, so a form control changes one
// node instead of re-serializing the manifest and losing the author's bytes.

import type { ChangeSpec } from "@codemirror/state";
import { isNode, isScalar, parseDocument, stringify } from "yaml";
import type { Node } from "yaml";

import { literatureNoteTemplateManifestRange } from "@zotlit/templates/facade";

/**
 * The value kinds a form control writes into the manifest. A multi-line YAML
 * value would land with its continuation lines at column 0, so patching one
 * node in place stays with the scalars the form owns.
 */
export type ManifestScalar = string | number | boolean | null;

/**
 * The document change that replaces the manifest node at `path` with `value`.
 * A replaced string keeps the scalar style it had, so an author's quoting
 * survives a form edit.
 * @returns null when the draft has no closed manifest or the path names no node.
 */
export function manifestValueEdit(
  source: string,
  path: readonly (string | number)[],
  value: ManifestScalar,
): ChangeSpec | null {
  const found = manifestNode(source, path);
  if (!found) return null;

  const { node, from, to } = found;
  return {
    from,
    to,
    insert: stringify(value, {
      lineWidth: 0,
      ...(typeof value === "string" && isScalar(node) && node.type
        ? { defaultStringType: node.type }
        : {}),
    }).trimEnd(),
  };
}

/**
 * Document offsets of the manifest node at `path`, so a problem can point at
 * the text that caused it.
 * @returns null when the draft has no closed manifest or the path names no node.
 */
export function manifestNodeRange(
  source: string,
  path: readonly (string | number)[],
): { from: number; to: number } | null {
  const found = manifestNode(source, path);
  return found && { from: found.from, to: found.to };
}

function manifestNode(
  source: string,
  path: readonly (string | number)[],
): { node: Node; from: number; to: number } | null {
  let manifest;
  try {
    manifest = literatureNoteTemplateManifestRange(source);
  } catch {
    return null;
  }

  const node = parseDocument(source.slice(manifest.from, manifest.to)).getIn(
    path,
    true,
  );
  if (!isNode(node) || !node.range) return null;

  const [start, end] = node.range;
  return { node, from: manifest.from + start, to: manifest.from + end };
}
