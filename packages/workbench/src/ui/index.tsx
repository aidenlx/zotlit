// The Workbench UI: the headless component tree both the web Template
// Workbench and the Obsidian Profile Editor mount over one Profile document
// (ADR 0044). It renders structure and behaviour; the host supplies the look
// through `WorkbenchThemeProvider` and its popups through
// `WorkbenchHostProvider`, and each editor instance keeps its view state in
// the store `WorkbenchEditorProvider` carries beside the document controller.

export { m } from "./paraglide/messages.js";

export { EditToolbar } from "./edit-toolbar";
export {
  WorkbenchEditorProvider,
  useDocumentRevision,
  useOptionalEditor,
  useWorkbenchController,
  useWorkbenchEditor,
  useWorkbenchStore,
} from "./editor";
export type { WorkbenchEditor } from "./editor";
export { WorkbenchHostProvider, useTooltip, useWorkbenchHost } from "./host";
export type {
  WorkbenchConfirmRequest,
  WorkbenchDialogHandle,
  WorkbenchDialogRequest,
  WorkbenchHost,
  WorkbenchHoverCardHandle,
  WorkbenchHoverCardRequest,
  WorkbenchInsertTarget,
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
export { diagnosticText, problemText } from "./problems";
export type { ProblemText } from "./problems";
export { ProblemsFooter, problemWhere } from "./problems-footer";
export { createWorkbenchStore } from "./store";
export type {
  ExplorerVariant,
  PreviewMode,
  TemplateRoot,
  WorkbenchItemChoice,
  WorkbenchStore,
  WorkbenchViewActions,
  WorkbenchViewState,
} from "./store";
export { TabBar, TabPanel } from "./tab-bar";
export { TABS, TAB_LABEL, TAB_LEDE } from "./tabs";
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
export { ResultColumn, ResultHeader, ResultRegion } from "./result-column";
export type { ResultColumnProps } from "./result-column";
export { PropertyList, PropertyValue, propertyText } from "./property-list";

export { PreviewControls } from "./preview-controls";
