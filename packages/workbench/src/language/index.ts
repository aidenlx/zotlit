export { eta, etaLanguage, etaRange, etaBody } from "./eta-language";
export type { EtaRange } from "./eta-language";
export { etaAutoPair } from "./eta-auto-pair";
export {
  liquidTemplate,
  liquidBody,
  liquidRanges,
  STRUCTURAL_TAGS,
} from "./liquid";
export type { LiquidRange } from "./liquid";
export { jsonRule, embeddedJsonE } from "./json-e-language";
export {
  applyTemplateCompletion,
  completionSuggestion,
  templateCompletion,
} from "./completion";
export type {
  SuggestionSource,
  TemplateCompletionPresentation,
} from "./completion";
export { completionEdit, hoverHint, rootAt, suggestions } from "./suggestions";
export type {
  Suggestion,
  SuggestionCategory,
  SuggestionConfig,
  SuggestionResult,
  CompletionEdit,
} from "./suggestions";

export {
  templateHighlighter,
  templateHighlighting,
  templateToken,
} from "./highlight";
export type { TemplateToken } from "./highlight";
export { embeddedTemplates } from "./embedded";

export { templatePairing } from "./pairing";
export type { PairingSource } from "./pairing";
