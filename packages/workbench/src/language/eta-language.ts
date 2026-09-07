// Eta v4 tag language: Lezer delimiters with JavaScript mounted in each tag body.
import {
  HighlightStyle,
  LanguageSupport,
  LRLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";

import { etaAutoPair } from "./eta-auto-pair";
import { etaParser } from "./eta-syntax";
export { etaRange } from "./eta-syntax";
export type { EtaRange } from "./eta-syntax";

export const etaLanguage = LRLanguage.define({
  name: "eta",
  parser: etaParser,
});

export const eta = new LanguageSupport(etaLanguage, [
  etaAutoPair(),
  syntaxHighlighting(
    HighlightStyle.define([
      { tag: tags.special(tags.brace), class: "zt-eta-delimiter" },
    ]),
  ),
]);
