// Eta v4 tag language: Lezer delimiters with JavaScript mounted in each tag body.
import { javascriptLanguage } from "@codemirror/lang-javascript";
import {
  HighlightStyle,
  LanguageSupport,
  LRLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import { parseMixed } from "@lezer/common";
import { styleTags, tags } from "@lezer/highlight";

import { etaAutoPair } from "./eta-auto-pair";
import { parser } from "./eta-parser";

export const etaLanguage = LRLanguage.define({
  name: "eta",
  parser: parser.configure({
    props: [
      styleTags({
        "TagOpen TagOpenInterp TagOpenRaw TagClose": tags.special(tags.brace),
      }),
    ],
    wrap: parseMixed((node) =>
      node.name === "TagContent" ? { parser: javascriptLanguage.parser } : null,
    ),
  }),
});

export const eta = new LanguageSupport(etaLanguage, [
  etaAutoPair(),
  syntaxHighlighting(
    HighlightStyle.define([
      { tag: tags.special(tags.brace), class: "zt-eta-delimiter" },
    ]),
  ),
]);

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
  const tree = etaLanguage.parser.parse(source);
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
