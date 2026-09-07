// Shared authoring controls inherit Obsidian's surfaces and editor typography.
import { EditorView } from "@codemirror/view";

import { templateHighlighting } from "@zotlit/workbench/language";
import type { WorkbenchTheme, WorkbenchIcon } from "@zotlit/workbench/ui";

import { Icon } from "@/components/obsidian/icon";
import { cn } from "@/lib/utils";

export const profileEditorIcons: Record<WorkbenchIcon, string> = {
  add: "plus",
  remove: "trash-2",
  "move-up": "arrow-up",
  "move-down": "arrow-down",
  "choose-sample": "search",
  basic: "sliders-horizontal",
  advanced: "code",
  undo: "undo-2",
  redo: "redo-2",
  preview: "eye",
  edit: "pencil",
  "chevron-down": "chevron-down",
  "chevron-right": "chevron-right",
};
const row = "zt:flex zt:items-center zt:gap-2";
const stack = "zt:flex zt:flex-col zt:gap-3";
export const profileEditorTheme: WorkbenchTheme = {
  icon: (name) => <Icon name={profileEditorIcons[name]} />,
  editorExtension: () => [
    templateHighlighting,
    EditorView.theme({
      "&": {
        backgroundColor: "var(--background-primary)",
        color: "var(--text-normal)",
      },
      ".cm-scroller": {
        fontFamily: "var(--font-text)",
        lineHeight: "var(--line-height-normal)",
      },
      ".cm-content": {
        padding: "var(--size-4-2) 0",
        caretColor: "var(--text-normal)",
      },
    }),
  ],
  classes: {
    match: {
      button: "zt:inline-flex zt:items-center zt:gap-1.5",
      "icon-button": "clickable-icon zt:shrink-0",
      input: "zt:min-w-0 zt:flex-1",
      "chip-input": "zt:min-w-12 zt:flex-1 zt:w-12",
      "chip-value": "zt:min-w-0 zt:[overflow-wrap:anywhere]",
      hint: "zt:text-xs zt:text-muted-foreground",

      pane: "zt:flex zt:min-w-0 zt:flex-col zt:gap-3",
      fieldset: "zt:min-w-0 zt:border-0 zt:p-0",
      group:
        "zt:flex zt:min-w-0 zt:flex-1 zt:flex-col zt:gap-2 zt:rounded-md zt:border zt:border-border zt:p-2 zt:data-[state=root]:border-0 zt:data-[state=root]:p-0",
      rows: "zt:flex zt:flex-col zt:gap-2 zt:list-none zt:m-0 zt:p-0",
      row: "zt:flex zt:min-w-0 zt:items-start zt:gap-2",
      condition: "zt:min-w-0 zt:flex-1",
      statement: "zt:flex zt:flex-wrap zt:min-w-0 zt:items-start zt:gap-1",
      actions: "zt:flex zt:flex-wrap zt:items-center zt:gap-1",
      control: "zt:min-w-0 zt:max-w-full",
      chips:
        "zt:flex zt:flex-1 zt:min-w-0 zt:flex-wrap zt:items-center zt:gap-1",
      chip: "zt:inline-flex zt:min-w-0 zt:items-center zt:gap-1 zt:rounded-sm zt:border zt:border-border zt:px-1",
      expression:
        "zt:min-w-0 zt:flex-1 zt:font-mono zt:[field-sizing:content] zt:resize-y",
      conjunction: "zt:text-xs",
      result: "zt:text-sm",
      error: "zt:text-xs",
    },
    editToolbar: {
      "edit-toolbar": cn(row, "zt:p-2"),
      "mode-group": row,
      "toolbar-actions": row,
      undo: "clickable-icon",
      redo: "clickable-icon",
    },
    previewControls: {
      controls: cn(row, "zt:flex-wrap"),
      label: row,
      paused: "zt:text-muted",
    },
    resultHeader: {
      header: stack,
      heading: "zt:text-base zt:font-semibold",
      controls: cn(row, "zt:flex-wrap"),
      label: row,
    },
    resultRegion: { region: stack },
    resultColumn: {
      filename: "zt:font-semibold",
      problem: "zt:text-error",
      stale: "zt:text-muted",
      pending: "zt:text-muted",
    },
    propertyList: {
      note: "zt:grid zt:grid-cols-[auto_1fr] zt:gap-x-3 zt:gap-y-1",
      list: "zt:grid zt:grid-cols-[auto_1fr] zt:gap-x-3 zt:gap-y-1",
      fold: "zt:grid zt:grid-cols-[auto_1fr] zt:gap-x-3 zt:gap-y-1",
      key: "zt:text-muted",
      value: "zt:min-w-0 zt:break-words",
    },
    tabBar: {
      "tab-bar": cn(row, "zt:px-2 zt:pb-2"),
      tab: "zt:shrink-0",
    },
    tabPanel: { "tab-panel": "zt:p-3" },
    sliceEditor: {
      "slice-editor": "markdown-source-view mod-cm6 cm-s-obsidian",
      "slice-scroll": "zt:overflow-auto",
    },
    notePane: {
      "annotation-box": row,
      "annotation-actions": row,
      "annotation-toggle": "clickable-icon",
      "annotation-edit": "clickable-icon",
    },
    properties: {
      pane: stack,
      rows: stack,
      row: "zt:border zt:border-border zt:rounded-md zt:p-2",
      "row-header": row,
      "row-actions": row,
      actions: row,
      form: stack,
      field: stack,
      "field-group": row,
      "confirm-actions": row,
      "expression-header": row,
      "hidden-label": "zt:sr-only",
      "row-action": "clickable-icon",
      hint: "setting-item-description",
    },
    nameFolder: {
      pane: stack,
      group: stack,
      fields: stack,
      field: stack,
      "binding-row": "setting-item",
      "binding-heading": "setting-item-info",
      "binding-label": "setting-item-name",
      "toggle-row": row,
      switch: "checkbox-container",
      "identity-fields": stack,
      "advanced-fields": stack,
      actions: row,
      "confirmation-actions": row,
      help: "setting-item-description",
      muted: "setting-item-description",
      secondary: "setting-item-description",
      summary: row,
    },
    annotation: {
      pane: stack,
      "section-bar": stack,
      hint: "setting-item-description",
    },
    problemsFooter: {
      problems: "zt:p-3 zt:border-t zt:border-border",
      "problems-heading": "zt:font-semibold",
      "problems-text": "zt:text-muted",
      "problems-recovery": "zt:text-muted",
    },
  },
};
