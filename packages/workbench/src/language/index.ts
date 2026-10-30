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
export { VAULT_SEGMENT } from "./expression-options";
export { datasetVocabulary } from "./expression-vocabulary";
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
export { SIGNATURE_HINT_CLASS, signatureHint } from "./signature-hint-tooltip";
export { fieldPopup, fieldPopupKeyHost, syntaxCompletion } from "./field-popup";
export type {
  FieldPopup,
  FieldPopupKeyHost,
  FieldPopupKeys,
  FieldPopupRelease,
} from "./field-popup";
export type {
  HintParameter,
  HintSignature,
  SignatureHintOptions,
  SignatureHintResult,
} from "./signature-hint";

export { templatePairing } from "./pairing";
export type { PairingSource } from "./pairing";
export type { PlacedFault, Span } from "./span";
export { appendProse } from "./prose";
