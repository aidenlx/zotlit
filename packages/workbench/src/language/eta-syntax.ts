import { styleTags, tags } from "@lezer/highlight";
// Eta parsing and range resolution without editor state or DOM dependencies.

import { parser } from "./eta-parser";

export const etaParser = parser.configure({
  props: [
    styleTags({
      "TagOpen TagOpenInterp TagOpenRaw TagClose": tags.special(tags.brace),
    }),
  ],
});

export interface EtaRange {
  from: number;
  to: number;
  kind: "output" | "tag" | "comment";
  closed: boolean;
  /** The position sits inside an Eta quoted string. */
  inLiteral: boolean;
}

/**
 * The Eta tag whose body holds `position`, or `null` on host text or on the
 * delimiters themselves. An unfinished tag still counts, so suggestions open
 * while the author types.
 */
export function etaRange(source: string, position: number): EtaRange | null {
  const tree = etaParser.parse(source);
  let tag = tree.resolve(position, -1);
  while (tag.name !== "Tag" && tag.parent) tag = tag.parent;
  const open = tag.firstChild;
  if (tag.name !== "Tag" || !open || position < open.to) return null;
  const close = tag.getChild("TagClose");
  if (close && position > close.from) return null;
  const node = tree.resolveInner(position, -1);
  const literal = node.name === "String" || node.name === "BlockComment";
  const text = source.slice(node.from, node.to);
  let escapeStart = text.length - 2;
  while (text[escapeStart] === "\\") escapeStart--;
  const ended =
    node.name === "BlockComment"
      ? text.endsWith("*/")
      : text.length > 1 &&
        text.at(-1) === text[0] &&
        (text.length - 2 - escapeStart) % 2 === 0;
  const inside = literal && (position < node.to || !ended);
  return {
    from: tag.from,
    to: tag.to,
    kind:
      inside && node.name === "BlockComment"
        ? "comment"
        : open.name === "TagOpen"
          ? "tag"
          : "output",
    closed: !!close,
    inLiteral: inside && node.name === "String",
  };
}
