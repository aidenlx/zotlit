import { parseMixed } from "@lezer/common";
import { styleTags, tags } from "@lezer/highlight";
// Eta parsing and range resolution without editor state or DOM dependencies.
import { parser as javascriptParser } from "@lezer/javascript";

import { parser } from "./eta-parser";

export const etaParser = parser.configure({
  props: [
    styleTags({
      "TagOpen TagOpenInterp TagOpenRaw TagClose": tags.special(tags.brace),
    }),
  ],
  wrap: parseMixed((node) =>
    node.name === "TagContent" ? { parser: javascriptParser } : null,
  ),
});

export interface EtaRange {
  from: number;
  to: number;
  kind: "output" | "tag" | "comment";
  closed: boolean;
  /** The position sits inside a JavaScript string or template literal. */
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
  return {
    from: tag.from,
    to: tag.to,
    kind: node.name.endsWith("Comment")
      ? "comment"
      : open.name === "TagOpen"
        ? "tag"
        : "output",
    closed: !!close,
    inLiteral: node.name === "String" || node.name === "TemplateString",
  };
}
