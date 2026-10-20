// The theme a host supplies once: the class each part of the tree wears and
// the icons it draws. The tree marks its parts with `data-part` and their
// state with `data-state`, and carries no class of its own (ADR 0044).

import type { WorkbenchSliceId } from "#/document/controller";
import type { Extension } from "@codemirror/state";
import { createContext, useContext } from "react";
import type { ComponentType, ReactNode } from "react";

import type { SliceLanguage } from "./slice-editor";

/**
 * Every component of the tree and the parts it marks. A component that joins
 * the tree adds its entry here, so a host's class map is checked against it.
 */
export interface WorkbenchParts {
  match:
    | "button"
    | "remove-button"
    | "icon-button"
    | "input"
    | "chip-input"
    | "chip-value"
    | "chip-item"
    | "chip-line"
    | "chip-remove"
    | "hint"
    | "pane"
    | "fieldset"
    | "group"
    | "rows"
    | "row"
    | "condition"
    | "statement"
    | "predicate"
    | "kind-icon"
    | "fields"
    | "value"
    | "actions"
    | "control"
    | "chips"
    | "chip"
    | "expression"
    | "conjunction"
    | "handle"
    | "result"
    | "error";
  dataExplorer:
    | "hint"
    | "root-label"
    | "explorer"
    | "header"
    | "heading"
    | "search"
    | "body"
    | "empty";
  explorerTree:
    | "sections"
    | "section"
    | "section-header"
    | "section-chevron"
    | "section-label"
    | "section-count"
    | "tree"
    | "spacer"
    | "contents"
    | "group"
    | "chevron"
    | "chevron-icon"
    | "actions"
    | "action"
    | "key"
    | "value"
    | "hint"
    | "placeholder"
    | "color-swatch"
    | "link"
    | "long-toggle"
    | "row"
    | "opaque"
    | "color"
    | "string"
    | "number"
    | "boolean"
    | "null"
    | "undefined"
    | "long-text";
  nameFolder:
    | "reset-button"
    | "reset-label"
    | "source-button"
    | "confirm-button"
    | "cancel-button"
    | "unreadable"
    | "pane"
    | "filename-editor"
    | "help"
    | "filename-result"
    | "muted"
    | "filename-status"
    | "filename-output"
    | "defaults"
    | "actions"
    | "default-label"
    | "default-value"
    | "secondary"
    | "details"
    | "summary"
    | "details-icon"
    | "identity-fields"
    | "advanced-fields"
    | "fields"
    | "readonly-input"
    | "group"
    | "heading"
    | "field"
    | "binding-row"
    | "path-row"
    | "binding-heading"
    | "binding-label"
    | "toggle-row"
    | "confirmation"
    | "strong"
    | "prose"
    | "confirmation-actions"
    | "input"
    | "binding-input"
    | "switch"
    | "switch-thumb";
  properties:
    | "pane"
    | "empty"
    | "rows"
    | "row"
    | "row-header"
    | "row-toggle"
    | "row-name"
    | "key"
    | "label"
    | "row-actions"
    | "edit"
    | "actions"
    | "form"
    | "field"
    | "name-input"
    | "hint"
    | "field-group"
    | "expression-header"
    | "format-label"
    | "hidden-label"
    | "confirm"
    | "text"
    | "confirm-actions"
    | "text-input"
    | "expression"
    | "diagnostics"
    | "summary"
    | "row-action"
    | "primary-action"
    | "secondary-action";
  annotation:
    | "help-bar"
    | "help-button"
    | "help-lede"
    | "help-toggle"
    | "help"
    | "sample-bar"
    | "problem"
    | "pane"
    | "pointer"
    | "heading"
    | "hint"
    | "section-bar"
    | "primary-action"
    | "section-go";
  sampleSuggester: "suggester" | "label" | "trigger" | "text-trigger";

  select: "wrapper" | "select" | "icon" | "option";
  sliceEditor: "slice-editor" | "slice-scroll";
  notePane:
    | "note-pane"
    | "annotation-box"
    | "annotation-label"
    | "annotation-actions"
    | "annotation-preview"
    | "annotation-selector"
    | "annotation-problem"
    | "pending"
    | "managed-label"
    | "managed-line"
    | "annotation-toggle"
    | "annotation-edit"
    | "partial-box"
    | "partial-name"
    | "partial-arguments"
    | "partial-problem";
  previewControls:
    | "controls"
    | "label"
    | "label-text"
    | "run"
    | "stop"
    | "paused";
  resultHeader:
    | "header"
    | "heading"
    | "controls"
    | "label"
    | "label-text"
    | "select";
  resultRegion: "region";
  resultColumn:
    | "stale"
    | "behind"
    | "behind-text"
    | "run"
    | "filename"
    | "filename-text"
    | "problem"
    | "problem-text"
    | "problem-heading"
    | "problem-output"
    | "problem-open"
    | "empty"
    | "pending"
    | "label"
    | "label-text";
  propertyList:
    | "key"
    | "value"
    | "empty"
    | "list"
    | "note"
    | "spread"
    | "row"
    | "icon"
    | "label"
    | "pills"
    | "pill"
    | "pill-text"
    | "text"
    | "checkbox";

  tabBar: "tab-bar" | "tab";
  tabPanel: "tab-panel" | "description";
  editToolbar:
    | "edit-toolbar"
    | "mode-group"
    | "mode"
    | "toolbar-actions"
    | "undo"
    | "redo";
  problemsFooter:
    | "problems"
    | "problems-summary"
    | "problems-heading"
    | "problems-count"
    | "problems-text"
    | "problems-space"
    | "problems-resize"
    | "problems-error-icon"
    | "problems-toggle"
    | "problems-body"
    | "problems-scroll"
    | "problems-select"
    | "problems-next"
    | "problems-object"
    | "problems-recovery"
    | "problems-location"
    | "problems-details"
    | "problems-details-label"
    | "problems-evidence"
    | "problems-report"
    | "problems-copy-failed"
    | "problems-controls"
    | "problems-copy"
    | "problems-community"
    | "problems-open";
}

export type WorkbenchComponent = keyof WorkbenchParts;

/** The class a host attaches to each part, by component. */
export type WorkbenchClassMap = {
  readonly [C in WorkbenchComponent]?: {
    readonly [P in WorkbenchParts[C]]?: string;
  };
};

/** The icons the tree asks for, named by role so each host picks the glyph. */
export type WorkbenchIcon =
  | "copy"
  | "help"
  | "confirm"
  | "add"
  | "remove"
  | "close"
  | "move-up"
  | "move-down"
  | "choose-sample"
  | "basic"
  | "advanced"
  | "undo"
  | "reset"
  | "redo"
  | "preview"
  | "edit"
  | "chevron-up"
  | "error"
  | "chevron-down"
  | "chevron-right"
  | "more"
  | "property-text"
  | "property-list"
  | "property-tags"
  | "property-aliases"
  | "property-number"
  | "property-checkbox"
  | "property-date"
  | "property-datetime"
  | "drag";

export interface WorkbenchTheme {
  readonly classes?: WorkbenchClassMap;
  readonly editorExtension?: (
    slice: WorkbenchSliceId,
    language: SliceLanguage,
  ) => Extension;
  /**
   * The host's CodeMirror extensions over every Filter Expression editor: a
   * Match condition's expression and a Formula. A host without one mounts
   * the editor's own extensions alone.
   */
  readonly expressionExtension?: () => Extension;
  /** Draws a named icon; a host without one draws none. */
  readonly icon?: (name: WorkbenchIcon) => ReactNode;
  /**
   * Draws a searchable select of the Match editor in the host's own control,
   * such as a popup with a search field. A select of a few fixed choices, and
   * every select of a host without one, is a native `<select>`.
   */
  readonly matchSelect?: ComponentType<MatchSelectProps>;
}

/** One choice of a Match editor select. */
export interface MatchSelectOption {
  value: string;
  label: string;
  /** The glyph before the label, such as the icon of a property's type. */
  icon?: ReactNode;
  /**
   * Muted text after the label in the host's list, such as a field's path. A
   * native select shows the label alone.
   */
  detail?: string;
}

/** What a Match editor select hands the control that draws it. */
export interface MatchSelectProps {
  "aria-label": string;
  value: string;
  options: readonly MatchSelectOption[];
  /** Shown while the value names no option, such as a choice not yet made. */
  placeholder?: string;
  /**
   * A list long or open-ended enough to search, such as the fields a
   * condition can test, which the host's own control draws. A few fixed
   * choices stay a native select.
   */
  searchable?: boolean;
  onChange: (value: string) => void;
  /** The part the select stands as, with the host's class for it. */
  "data-part"?: string;
  className?: string;
}

/** The host's control for a Match editor select, if it supplies one. */
export function useMatchSelect(): ComponentType<MatchSelectProps> | undefined {
  return useContext(ThemeContext).matchSelect;
}

const ThemeContext = createContext<WorkbenchTheme>({});

export function WorkbenchThemeProvider({
  theme,
  children,
}: {
  theme: WorkbenchTheme;
  children?: ReactNode;
}) {
  return (
    <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
  );
}

/** The attributes a part carries: its name, its state, and the host's class. */
export interface PartAttributes {
  "data-part": string;
  "data-state"?: string;
  className?: string;
}

/**
 * The part attributes of one component, read from the theme in context.
 *
 * @example
 *   const part = useParts("tabBar");
 *   <button {...part("tab", active ? "active" : "inactive")} />
 */
export function useParts<C extends WorkbenchComponent>(
  component: C,
): (part: WorkbenchParts[C], state?: string) => PartAttributes {
  const { classes } = useContext(ThemeContext);
  return (part, state) => {
    const className = classes?.[component]?.[part];
    return {
      "data-part": part,
      ...(state === undefined ? {} : { "data-state": state }),
      ...(className === undefined ? {} : { className }),
    };
  };
}

/** Draws a themed icon, or nothing where the host draws none. */
export function useIcon(): (name: WorkbenchIcon) => ReactNode {
  const { icon } = useContext(ThemeContext);
  return (name) => icon?.(name) ?? null;
}

/** The CodeMirror presentation supplied by the host theme. */
export function useEditorExtension() {
  return useContext(ThemeContext).editorExtension;
}

/** The host's CodeMirror extensions for Filter Expression editors. */
export function useExpressionExtension() {
  return useContext(ThemeContext).expressionExtension;
}
