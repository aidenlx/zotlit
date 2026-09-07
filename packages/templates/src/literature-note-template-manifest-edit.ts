// YAML range edits that preserve the surrounding Profile document bytes.
import { isMap, isNode, isScalar, parseDocument } from "yaml";

import {
  literatureNoteTemplateManifestRange,
  parseLiteratureNoteTemplate,
} from "./literature-note-template";

/** @throws When either document is invalid, including orphaned aliases. */
export function updateLiteratureNoteTemplateManifestKey(
  source: string,
  key: string,
  value: unknown,
): string {
  return updateLiteratureNoteTemplateManifestKeys(source, { [key]: value });
}

/** Validate related key edits together, after aliases in removed fields are gone. */
export function updateLiteratureNoteTemplateManifestKeys(
  source: string,
  changes: Readonly<Record<string, unknown>>,
): string {
  parseLiteratureNoteTemplate(source);
  let result = source;
  for (const [key, value] of Object.entries(changes))
    result = editManifestKey(result, key, value);
  parseLiteratureNoteTemplate(result);
  return result;
}

function editManifestKey(source: string, key: string, value: unknown): string {
  const { from, to } = literatureNoteTemplateManifestRange(source);
  const header = source.slice(from, to);
  const doc = parseDocument(header, { keepSourceTokens: true });
  if (!isMap(doc.contents)) throw new Error("Expected a manifest mapping");
  const pairs = doc.contents.items;
  const index = pairs.findIndex(
    ({ key: node }) => isScalar(node) && node.value === key,
  );
  const pair = pairs[index];
  const edits: { from: number; to: number; text: string }[] = [];
  if (pair) {
    if (
      !isNode(pair.value) ||
      !pair.value.range ||
      !isNode(pair.key) ||
      !pair.key.range
    )
      throw new Error("Expected manifest source ranges");
    const [start, end] = pair.value.range;
    const keyStart =
      pair.srcToken?.start.find((token) => token.type === "explicit-key-ind")
        ?.offset ?? pair.key.range[0];
    if (value !== undefined) {
      const contentEnd = start + header.slice(start, end).trimEnd().length;
      edits.push({ from: start, to: contentEnd, text: JSON.stringify(value) });
    } else if (doc.contents.flow) {
      edits.push({
        from: keyStart,
        to: end,
        text: "",
      });
      const comma = (index > 0 ? pair : pairs[1])?.srcToken?.start.find(
        (token) => token.type === "comma",
      );
      if (comma)
        edits.push({ from: comma.offset, to: comma.offset + 1, text: "" });
    } else {
      const lineStart = header.lastIndexOf("\n", keyStart - 1) + 1;
      const lineEnd = header.indexOf("\n", end - 1);
      edits.push({
        from: lineStart,
        to: lineEnd < 0 ? header.length : lineEnd + 1,
        text: "",
      });
    }
  } else if (value !== undefined) {
    if (doc.contents.flow) {
      const end = doc.contents.range![1] - 1;
      const token = doc.contents.srcToken;
      const trailingComma =
        token?.type === "flow-collection" &&
        token.items.at(-1)?.key === undefined &&
        token.items.at(-1)?.start.some((entry) => entry.type === "comma");
      edits.push({
        from: end,
        to: end,
        text: `${pairs.length && !trailingComma ? ", " : ""}${key}: ${JSON.stringify(value)}`,
      });
    } else {
      const eol = source.startsWith("---\r\n") ? "\r\n" : "\n";
      const indent = " ".repeat(doc.contents.srcToken?.indent ?? 0);
      edits.push({
        from: header.length,
        to: header.length,
        text: `${indent}${key}: ${JSON.stringify(value)}${eol}`,
      });
    }
  } else return source;
  let result = source;
  for (const edit of edits.sort((a, b) => b.from - a.from)) {
    result =
      result.slice(0, from + edit.from) +
      edit.text +
      result.slice(from + edit.to);
  }
  return result;
}
