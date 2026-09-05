export { eta, etaLanguage, etaRange } from "./eta-language";
export type { EtaRange } from "./eta-language";
export { etaAutoPair } from "./eta-auto-pair";
export {
  liquidMarkdown,
  liquidRanges,
  markdownSupport,
  STRUCTURAL_TAGS,
} from "./liquid";
export type { LiquidRange } from "./liquid";
export { yamlRule } from "./yaml";
export { applyTemplateCompletion, templateCompletion } from "./completion";
export type { SuggestionSource } from "./completion";
export { completionEdit, hoverHint, rootAt, suggestions } from "./suggestions";
export type {
  Suggestion,
  SuggestionCategory,
  SuggestionConfig,
  SuggestionResult,
  CompletionEdit,
} from "./suggestions";

export { templateHighlighting } from "./highlight";
export { profileLanguage, embeddedLiquid } from "./embedded";

export { templatePairing } from "./pairing";
export type { PairingSource } from "./pairing";
