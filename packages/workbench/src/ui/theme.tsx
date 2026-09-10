// The theme a host supplies once: the class each part of the tree wears and
// the icons it draws. The tree marks its parts with `data-part` and their
// state with `data-state`, and carries no class of its own (ADR 0044).

import type { WorkbenchSliceId } from "#/document/controller";
import type { Extension } from "@codemirror/state";
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

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
    | "fields"
    | "value"
    | "actions"
    | "control"
    | "chips"
    | "chip"
    | "expression"
    | "conjunction"
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
    | "markdown"
    | "result"
    | "heading"
    | "result-summary"
    | "result-rows"
    | "result-row"
    | "result-key"
    | "result-empty"
    | "summary"
    | "row-action"
    | "primary-action"
    | "secondary-action";
  annotation:
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
    | "annotation-edit";
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
    | "problem-heading"
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
    | "fold"
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
    | "problems-heading"
    | "problems-text"
    | "problems-recovery"
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
  | "property-datetime";

export interface WorkbenchTheme {
  readonly classes?: WorkbenchClassMap;
  readonly editorExtension?: (
    slice: WorkbenchSliceId,
    language: SliceLanguage,
  ) => Extension;
  /** Draws a named icon; a host without one draws none. */
  readonly icon?: (name: WorkbenchIcon) => ReactNode;
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
