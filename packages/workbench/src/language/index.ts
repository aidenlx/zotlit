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
export type { SuggestionSource, CompletionPresentation } from "./completion";
export {
  datasetExpressionFields,
  expressionCompletions,
  expressionOption,
  filterExpressionCompletion,
} from "./filter-expression-completion";
export type {
  ExpressionCompletionResult,
  ExpressionField,
  ExpressionName,
  ExpressionOption,
  ExpressionReceiver,
  ExpressionVocabulary,
} from "./filter-expression-completion";
export { datasetCustomFields } from "./expression-options";
export { datasetReceiver } from "./expression-receiver";
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
export { signatureAt } from "./signature-hint";
export {
  FIELD_POPUP_ATTRIBUTE,
  SIGNATURE_HINT_CLASS,
  signatureHint,
} from "./signature-hint-tooltip";
export type {
  HintParameter,
  HintSignature,
  SignatureHintOptions,
  SignatureHintResult,
} from "./signature-hint";

export { templatePairing } from "./pairing";
export type { PairingSource } from "./pairing";
export type { Span } from "./span";
