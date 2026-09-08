// Shared authoring controls inherit Obsidian's surfaces and editor typography.
import { templateHighlighting } from "@zotlit/workbench/language";
import type { WorkbenchTheme, WorkbenchIcon } from "@zotlit/workbench/ui";

import { Icon } from "@/components/obsidian/icon";
import { themeHook } from "@/lib/theme-hooks";
import { cn } from "@/lib/utils";

import { codePane, isCodePane } from "./editor-extension";

export const profileEditorIcons: Record<WorkbenchIcon, string> = {
  copy: "copy",
  confirm: "check",
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
/** A boxed pane wears Obsidian's text-input surface, focus ring included. */
const editorBox =
  "zt:rounded-(--input-radius) zt:border zt:border-border zt:bg-input zt:px-2 zt:py-1 zt:focus-within:border-border-focus zt:focus-within:shadow-[0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)]";
/** In-editor chrome — labels and boxes CodeMirror paints between lines — reads in the interface font. */
const editorChip =
  "zt:rounded-sm zt:border zt:border-border zt:bg-card zt:font-sans zt:text-xs zt:font-medium zt:leading-tight zt:text-muted-foreground";
/** An icon button small enough to sit inside a chip. */
const chipIcon = "clickable-icon zt:p-1 zt:[--icon-size:var(--icon-xs)]";
/** A one-line bar of chrome: a heading, a hint, and an action at the end. */
const bar =
  "zt:flex zt:flex-wrap zt:items-center zt:gap-x-3 zt:gap-y-1 zt:rounded-md zt:border zt:border-border zt:bg-card zt:px-2.5 zt:py-1.5 zt:text-xs";
export const profileEditorTheme: WorkbenchTheme = {
  icon: (name) => <Icon name={profileEditorIcons[name]} />,
  editorExtension: (slice, language) => [
    templateHighlighting,
    ...(isCodePane(slice, language) ? [codePane] : []),
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
    dataExplorer: {
      hint: "setting-item-description",
      "root-label": "zt:text-xs zt:text-faint zt:mr-auto",
      explorer: "zt:flex zt:min-h-0 zt:flex-1 zt:flex-col zt:gap-2 zt:p-2",
      header:
        "zt:flex zt:flex-wrap zt:items-center zt:justify-between zt:gap-2",
      heading: "zt:text-xs zt:font-semibold",
      variants: "zt:flex zt:gap-1",
      variant:
        "zt:text-xs zt:data-[state=active]:bg-(--interactive-accent) zt:data-[state=active]:text-(--text-on-accent)",
      search: "zt:w-full",
      body: "zt:min-h-0 zt:flex-1 zt:overflow-auto",
      empty: "zt:text-muted-foreground zt:text-xs",
    },
    explorerTree: {
      "simple-row": "zt:py-1",
      "simple-heading":
        "zt:flex zt:min-w-0 zt:flex-wrap zt:items-baseline zt:gap-x-2",
      path: "zt:text-xs zt:font-mono zt:text-faint",
      "simple-value": "zt:text-xs",
      tree: "zt:font-mono zt:text-xs zt:leading-relaxed zt:data-[state=simple]:[font-family:var(--font-interface)]",
      spacer: "zt:mt-[3px] zt:size-3 zt:shrink-0",
      contents: "zt:min-w-0 zt:flex-1 zt:select-text",
      group:
        "zt:ml-3 zt:border-l zt:border-(--nav-indentation-guide-color) zt:pl-2",
      chevron:
        "zt:mt-[3px] zt:flex zt:size-3 zt:shrink-0 zt:cursor-pointer zt:items-center zt:justify-center zt:text-(--nav-collapse-icon-color) zt:transition-transform zt:duration-100 zt:ease-out zt:hover:text-foreground zt:data-[expanded]:rotate-90",
      "chevron-icon": "zt:size-3 zt:[&_svg]:size-3",
      actions:
        "zt:absolute zt:top-0.5 zt:right-0 zt:flex zt:items-center zt:gap-0.5 zt:bg-linear-to-l zt:from-background zt:from-60% zt:to-transparent zt:pl-6 zt:opacity-0 zt:group-hover:opacity-100 zt:focus-within:opacity-100",
      action:
        "zt:rounded-xs zt:flex zt:size-4 zt:cursor-pointer zt:items-center zt:justify-center zt:text-muted-foreground zt:hover:bg-muted zt:hover:text-foreground",
      key: "zt:text-foreground",
      hint: "zt:text-faint",
      placeholder: "zt:text-faint zt:italic",
      "color-swatch":
        "zt:rounded-xs zt:size-3 zt:shrink-0 zt:border zt:border-border",
      link: "zt:break-all zt:text-link zt:underline zt:decoration-dotted zt:hover:decoration-solid",
      "long-toggle":
        "zt:rounded-xs zt:ml-0.5 zt:cursor-pointer zt:px-1 zt:text-muted-foreground zt:underline zt:decoration-dotted zt:underline-offset-2 zt:select-none zt:hover:bg-muted zt:hover:text-foreground",
      row: "zt:group zt:rounded zt:relative zt:flex zt:min-w-0 zt:items-start zt:gap-x-1 zt:px-0.5 zt:hover:bg-muted zt:data-[state=matched]:bg-(--text-highlight-bg)",
      opaque: "zt:break-words zt:text-cyan",
      color: "zt:inline-flex zt:min-w-0 zt:items-center zt:gap-1 zt:text-green",
      string: "zt:text-green",
      number: "zt:text-blue",
      boolean: "zt:text-purple",
      null: "zt:text-faint zt:italic",
      undefined: "zt:text-faint zt:italic",
      "long-text":
        "zt:data-[state=expanded]:break-words zt:data-[state=expanded]:whitespace-pre-wrap",
    },
    startHere: {
      strip:
        "zt:mx-2 zt:mb-2 zt:rounded zt:border zt:border-border zt:p-2 zt:text-sm",
      heading: "zt:flex zt:items-center zt:justify-between zt:gap-2",
      line: "zt:my-1 zt:text-muted",
      dismiss: "",
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
      "slice-editor": cn(
        "markdown-source-view mod-cm6 cm-s-obsidian zt:min-h-0",
        themeHook.templateEditor,
      ),
      "slice-scroll": "zt:min-h-0 zt:overflow-auto",
    },
    notePane: {
      "annotation-box": cn(
        editorChip,
        "zt:inline-flex zt:max-w-full zt:items-center zt:gap-1 zt:rounded-md zt:p-0.5 zt:ps-2 zt:align-middle",
      ),
      "annotation-label": "zt:min-w-0 zt:whitespace-normal",
      "annotation-actions": "zt:inline-flex zt:shrink-0 zt:items-center",
      "annotation-toggle": chipIcon,
      "annotation-edit": chipIcon,
      "annotation-preview":
        "zt:mx-2 zt:my-1 zt:cursor-default zt:rounded-md zt:border zt:border-border zt:bg-background zt:p-2 zt:font-sans zt:text-sm zt:whitespace-normal zt:select-text",
      "annotation-selector": "zt:mb-2",
      "annotation-problem":
        "zt:mb-2 zt:border-s-2 zt:border-(--text-error) zt:ps-2 zt:text-xs zt:text-muted-foreground",
      pending: "zt:text-xs zt:text-muted-foreground",
      "managed-label": cn(
        editorChip,
        "zt:inline-block zt:cursor-(--cursor-clickable) zt:px-2 zt:py-0.5 zt:select-none",
      ),
      "managed-line": "zt-profile-editor-managed",
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
      "field-group": "zt:flex zt:flex-col zt:gap-1.5",
      "confirm-actions": row,
      "expression-header": row,
      "hidden-label": "zt:sr-only",
      "row-action": "clickable-icon",
      hint: "setting-item-description",
      expression: cn(
        editorBox,
        "zt:flex zt:min-h-28 zt:min-w-0 zt:flex-1 zt:flex-col",
      ),
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
      "filename-editor": editorBox,
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
      "sample-bar": row,
      problem: "zt:mb-2 zt:text-xs zt:text-(--text-error)",
      pane: stack,
      pointer: cn(bar, "zt:mt-2"),
      heading: "zt:font-semibold",
      hint: "zt:text-muted-foreground",
      "section-bar": cn(bar, "zt:mb-2"),
      "primary-action": "zt:ms-auto",
      "section-go": "zt:ms-auto",
    },
    sampleSuggester: {
      suggester: "zt:flex zt:min-w-0 zt:flex-1 zt:items-center zt:gap-2",
      label:
        "zt:min-w-0 zt:flex-1 zt:truncate zt:text-xs zt:text-muted-foreground",
      trigger: "clickable-icon zt:shrink-0",
    },
    problemsFooter: {
      problems: "zt:p-3 zt:border-t zt:border-border",
      "problems-heading": "zt:font-semibold",
      "problems-text": "zt:text-muted",
      "problems-recovery": "zt:text-muted",
    },
  },
};
