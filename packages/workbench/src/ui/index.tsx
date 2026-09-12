export { MatchPane } from "./match";
// The Workbench UI: the headless component tree both the web Template
// Workbench and the Obsidian Template Workbench View mount over one Template
// Document
// (ADR 0044). It renders structure and behaviour; the host supplies the look
// through `WorkbenchThemeProvider` and its popups through
// `WorkbenchHostProvider`, and each editor instance keeps its view state in
// the store `WorkbenchEditorProvider` carries beside the document controller
// and the one Render Scheduler its result surfaces share.

export { WorkbenchMessagesProvider, useWorkbenchMessages } from "./messages";
export type { WorkbenchMessages } from "./generated/messages";

export { EditToolbar } from "./edit-toolbar";
export {
  createWorkbenchEditor,
  WorkbenchEditorProvider,
  useDocumentRevision,
  useOptionalEditor,
  useRenderScheduler,
  useRenderState,
  useWorkbenchController,
  useWorkbenchEditor,
  useWorkbenchStore,
} from "./editor";
export type { WorkbenchEditor, WorkbenchEditorInstance } from "./editor";
export { WorkbenchHostProvider, useTooltip, useWorkbenchHost } from "./host";
export type {
  WorkbenchConfirmRequest,
  WorkbenchDialogHandle,
  WorkbenchDialogRequest,
  WorkbenchHost,
  WorkbenchInsertTarget,
  WorkbenchInputSuggestionsRequest,
  WorkbenchLibrary,
  WorkbenchMatchData,
  WorkbenchMenuItem,
  WorkbenchMenuRequest,
  WorkbenchPersistence,
  WorkbenchPreferenceScope,
  WorkbenchSuggesterGroup,
  WorkbenchSuggesterOption,
  WorkbenchSuggesterRequest,
} from "./host";
export {
  diagnosisEngineSources,
  diagnosisExplanation,
  diagnosisLabel,
  diagnosisReport,
  diagnosisWhere,
  diagnosticText,
  documentDiagnosis,
  problemAction,
  problemText,
  renderDiagnosis,
  workbenchDiagnoses,
} from "./problems";
export type {
  DiagnosisExplanation,
  ProblemText,
  WorkbenchDiagnosis,
} from "./problems";
export {
  ProblemsFooter,
  problemWhere,
  useWorkbenchProblems,
} from "./problems-footer";
export type {
  WorkbenchProblemCapture,
  WorkbenchProblemsState,
} from "./problems-footer";
export { createRenderScheduler } from "./scheduler";
export type {
  RenderScheduler,
  RenderSchedulerInput,
  RenderSchedulerOptions,
  RenderSchedulerState,
  RenderTrigger,
} from "./scheduler";
export { createWorkbenchStore } from "./store";
export type {
  PreviewMode,
  PreviewSettings,
  TemplateRoot,
  WorkbenchItemChoice,
  WorkbenchStore,
  WorkbenchViewActions,
  WorkbenchViewState,
} from "./store";
export { citationExampleLabel, citationVariantLabel } from "./citation-preview";
export { partialContextLabel } from "./partial-preview";
export { TabBar, TabPanel } from "./tab-bar";
export { TABS, tabLabel, tabLede, tabsFor } from "./tabs";
export type { WorkbenchTab } from "./tabs";
export { WorkbenchThemeProvider, useIcon, useParts } from "./theme";
export type {
  PartAttributes,
  WorkbenchClassMap,
  WorkbenchComponent,
  WorkbenchIcon,
  WorkbenchParts,
  WorkbenchTheme,
} from "./theme";

export { NotePane } from "./note-pane";
export type { NotePaneProps } from "./note-pane";
export { usePartialBoxes } from "./partial-boxes";
export type { PartialBoxes, PartialPlaceholderHost } from "./partial-boxes";
export { SliceEditor } from "./slice-editor";
export type {
  SliceEditorProps,
  SliceLanguage,
  SuggestionSource,
} from "./slice-editor";
export { useOptionalHost } from "./host";
export type { WorkbenchMarkdownProps } from "./host";

export { COMMON_FIELDS, completionFields } from "./completion-fields";
export type { CommonField } from "./completion-fields";
export { tagDescription } from "./tag-help";
export {
  ResultBody,
  ResultColumn,
  ResultHeader,
  ResultRegion,
} from "./result-column";
export type {
  ResultBodyProps,
  ResultColumnProps,
  ResultMode,
} from "./result-column";
export {
  PropertyList,
  PropertyValue,
  propertyText,
  propertyType,
} from "./property-list";
export type { PropertyType } from "./property-list";

export { PreviewControls } from "./preview-controls";

export { NameFolderPane, BUILT_IN_BINDING_DEFAULTS } from "./name-folder";
export type { NameFolderPaneProps } from "./name-folder";
export { PropertiesPane } from "./properties-tab";
export type { EntryDiagnostic, PropertiesPaneProps } from "./properties-tab";
export {
  AnnotationPane,
  AnnotationPointer,
  AnnotationSampleBar,
  annotationOption,
  AnnotationSectionBar,
} from "./annotation";
export { annotationSamples } from "./annotation-samples";
export { SampleSuggester } from "./sample-suggester";
export type { SampleOption } from "./sample-suggester";

export { DisplayTree } from "./explorer-tree";
export type { DisplaySection, DisplayTreeProps } from "./explorer-tree";
export {
  commonRows,
  fieldValueText,
  rowMatches,
  fieldSnippet,
} from "./explorer-fields";
export {
  explorerSectionIds,
  explorerSections,
  fieldLabel,
  sentenceCase,
  visibleSectionIds,
} from "./explorer-sections";
export type {
  ExplorerReader,
  ExplorerSection,
  ExplorerSectionId,
} from "./explorer-sections";
export { DataExplorer } from "./data-explorer";
export type { DataExplorerProps, ExplorerPresentation } from "./data-explorer";
