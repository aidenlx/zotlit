// Eta v4 tag delimiters with plain tag bodies.
import { LanguageSupport, LRLanguage } from "@codemirror/language";
import { parseMixed } from "@lezer/common";

import { etaAutoPair } from "./eta-auto-pair";
import { etaParser } from "./eta-syntax";
import { markdownParser } from "./markdown";
export { etaRange } from "./eta-syntax";
export type { EtaRange } from "./eta-syntax";

export const etaLanguage = LRLanguage.define({
  name: "eta",
  parser: etaParser,
});

export const eta = new LanguageSupport(etaLanguage, [etaAutoPair()]);

export const etaBody = etaLanguage.configure({
  wrap: parseMixed((node) =>
    node.type.isTop
      ? {
          parser: markdownParser,
          overlay: (child) => child.name === "Text",
        }
      : null,
  ),
});
