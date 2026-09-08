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
  reset: "rotate-ccw",
  redo: "redo-2",
  preview: "eye",
  edit: "pencil",
  "chevron-down": "chevron-down",
  "chevron-right": "chevron-right",
};
const row = "zt:flex zt:items-center zt:gap-2";
const stack = "zt:flex zt:min-w-0 zt:flex-col zt:gap-3";
const field = "zt:flex zt:min-w-0 zt:flex-col zt:gap-1.5";
const actions = "zt:flex zt:flex-wrap zt:items-center zt:gap-2";
const hint =
  "zt:text-xs zt:leading-normal zt:text-muted-foreground zt:text-pretty";
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
      button: cn(
        "zt:inline-flex zt:items-center zt:gap-1.5 zt:text-muted-foreground",
        "zt:[--input-shadow:none] zt:[--interactive-hover:var(--background-modifier-hover)] zt:[--interactive-normal:transparent]",
      ),
      "icon-button": "clickable-icon zt:shrink-0",
      input: "zt:min-w-0 zt:w-full zt:flex-1",
      "chip-input":
        "zt:[field-sizing:content] zt:w-auto zt:max-w-full zt:min-w-[2ch] zt:flex-none zt:self-center zt:[--background-modifier-form-field:transparent] zt:[--input-height:auto] zt:[--input-padding:0px]",
      "chip-value": "zt:min-w-0 zt:[overflow-wrap:anywhere]",
      hint: "zt:text-xs zt:leading-normal zt:text-pretty zt:text-muted-foreground",
      pane: cn(
        "zt:flex zt:min-w-0 zt:flex-col zt:gap-4 zt:text-sm",
        "zt:[--icon-size:var(--icon-s)] zt:[--icon-stroke:var(--icon-s-stroke-width)]",
        "zt:[&>p]:text-xs zt:[&>p]:leading-normal zt:[&>p]:text-pretty zt:[&>p]:text-muted-foreground",
      ),
      fieldset:
        "zt:flex zt:min-w-0 zt:flex-col zt:items-start zt:gap-4 zt:border-0 zt:p-0",
      group:
        "zt:flex zt:min-w-0 zt:w-full zt:flex-1 zt:flex-col zt:gap-1.5 zt:data-[state=nested]:rounded-md zt:data-[state=nested]:border zt:data-[state=nested]:border-border zt:data-[state=nested]:bg-card zt:data-[state=nested]:p-1.5 zt:[&>[data-part=actions]:first-child]:justify-between zt:[&>[data-part=actions]:first-child]:[--input-shadow:none] zt:[&>[data-part=actions]:first-child]:[--dropdown-background:transparent] zt:[&>[data-part=actions]:first-child]:[--dropdown-background-hover:var(--background-modifier-hover)] zt:[&>[data-part=actions]:last-child]:pt-1",
      rows: "zt:flex zt:flex-col zt:gap-1.5 zt:list-none zt:m-0 zt:p-0",
      row: "zt:grid zt:min-w-0 zt:grid-cols-[2.25rem_minmax(0,1fr)] zt:items-center zt:gap-x-2 zt:[&>[data-part=group]]:col-start-2",
      condition: "zt:col-start-2 zt:min-w-0",
      statement: cn(
        "zt:grid zt:min-w-0 zt:grid-cols-[auto_auto_minmax(0,1fr)_auto] zt:items-start zt:overflow-hidden zt:rounded-md zt:bg-input zt:ring-1 zt:ring-border-hover zt:focus-within:ring-2 zt:focus-within:ring-border-focus",
        "zt:[--dropdown-background-hover:var(--background-modifier-form-field-hover)] zt:[--dropdown-background:var(--background-modifier-form-field)] zt:[--input-border-width-focus:0px] zt:[--input-border-width:0px] zt:[--input-radius:0px] zt:[--input-shadow:none]",
        "zt:[&_[data-part=wrapper]>select]:w-full zt:[&>[data-part=wrapper]]:border-border zt:[&>[data-part=wrapper]:nth-child(2)]:border-s",
        "zt:[&>[data-part=actions]]:col-start-4 zt:[&>[data-part=actions]]:row-start-1 zt:[&>[data-part=actions]]:h-(--input-height) zt:[&>[data-part=actions]]:flex-nowrap zt:[&>[data-part=actions]]:gap-0 zt:[&>[data-part=actions]]:border-s zt:[&>[data-part=actions]]:border-border zt:[&>[data-part=actions]]:px-0.5",
        "zt:@container zt:[&:has([aria-invalid=true])]:ring-(--background-modifier-error)",
        "zt:[&>:is([data-part=input],div[data-part=control],[data-part=wrapper]:nth-child(3))]:col-span-4 zt:[&>:is([data-part=input],div[data-part=control],[data-part=wrapper]:nth-child(3))]:row-start-2 zt:[&>:is([data-part=input],div[data-part=control],[data-part=wrapper]:nth-child(3))]:border-s-0 zt:[&>:is([data-part=input],div[data-part=control],[data-part=wrapper]:nth-child(3))]:border-t zt:[&>:is([data-part=input],div[data-part=control],[data-part=wrapper]:nth-child(3))]:border-border",
        "zt:@xl:[&>:is([data-part=input],div[data-part=control],[data-part=wrapper]:nth-child(3))]:col-span-1 zt:@xl:[&>:is([data-part=input],div[data-part=control],[data-part=wrapper]:nth-child(3))]:col-start-3 zt:@xl:[&>:is([data-part=input],div[data-part=control],[data-part=wrapper]:nth-child(3))]:row-start-1 zt:@xl:[&>:is([data-part=input],div[data-part=control],[data-part=wrapper]:nth-child(3))]:border-s zt:@xl:[&>:is([data-part=input],div[data-part=control],[data-part=wrapper]:nth-child(3))]:border-t-0",
      ),
      actions: "zt:flex zt:flex-wrap zt:items-center zt:gap-1.5",
      control:
        "zt:min-w-0 zt:max-w-full zt:[div&]:flex zt:[div&]:flex-col zt:[span&]:px-2 zt:[span&]:pb-1 zt:[span&]:text-xs zt:[span&]:leading-normal zt:[span&]:text-muted-foreground",
      chips:
        "zt:col-span-4 zt:row-start-2 zt:flex zt:min-h-(--input-height) zt:min-w-0 zt:flex-wrap zt:items-center zt:gap-1 zt:border-t zt:border-border zt:px-1.5 zt:py-1 zt:@xl:col-span-1 zt:@xl:col-start-3 zt:@xl:row-start-1 zt:@xl:border-s zt:@xl:border-t-0 zt:[&>div:last-of-type]:max-w-[calc(100%_-_2ch_-_0.25rem)]",
      chip: "zt:inline-flex zt:max-w-full zt:items-center zt:gap-0.5 zt:self-start zt:rounded-sm zt:bg-muted zt:py-0.5 zt:ps-1.5 zt:text-sm zt:leading-tight zt:[&>[data-part=icon-button]]:size-7 zt:[&_[data-part=icon-button]>svg]:shrink-0",
      expression:
        "zt:col-span-3 zt:min-w-0 zt:w-full zt:font-mono zt:text-sm zt:leading-normal zt:[field-sizing:content] zt:resize-y",
      conjunction:
        "zt:col-start-1 zt:row-start-1 zt:text-end zt:text-sm zt:text-muted-foreground",
      result: "zt:text-xs zt:leading-normal zt:text-muted-foreground",
      error:
        "zt:pt-1 zt:text-xs zt:leading-normal zt:text-pretty zt:text-(--text-error)",
    },
    dataExplorer: {
      hint: "setting-item-description zt:px-3 zt:pb-2",
      "root-label": "zt:text-xs zt:text-muted-foreground",
      explorer:
        "zt-template-data-explorer zt:flex zt:min-h-0 zt:min-w-0 zt:flex-1 zt:flex-col zt:gap-3 zt:pt-3",
      header:
        "zt:grid zt:grid-cols-[1fr_auto] zt:items-center zt:gap-x-2 zt:gap-y-3 zt:px-3",
      heading: "",
      variants:
        "zt:col-span-2 zt:flex zt:flex-wrap zt:gap-1 zt:rounded-md zt:bg-card zt:p-1",
      variant:
        "clickable-icon zt:flex-1 zt:text-sm zt:whitespace-normal zt:focus-visible:shadow-(--input-box-shadow-focus)",
      search: "zt:mx-3 zt:w-auto zt:min-w-0 zt:shrink-0",
      body: "zt:min-h-0 zt:flex-1 zt:overflow-auto zt:px-2 zt:pb-3",
      empty:
        "zt:px-1 zt:py-3 zt:text-muted-foreground zt:text-sm zt:leading-normal",
    },
    explorerTree: {
      "simple-row": "zt:flex zt:min-w-0 zt:flex-col zt:gap-1",
      "simple-heading": "zt:text-sm zt:font-medium zt:leading-normal",
      path: "zt:hidden",
      "simple-value": "zt:text-sm zt:leading-normal",
      tree: "zt:group/tree zt:font-mono zt:text-xs zt:leading-normal zt:data-[state=simple]:font-sans",
      spacer: "zt:w-6 zt:shrink-0",
      contents:
        "zt:min-w-0 zt:flex-1 zt:select-text zt:[overflow-wrap:anywhere]",
      group:
        "zt:ms-2.5 zt:border-s zt:border-(--nav-indentation-guide-color) zt:ps-2",
      chevron:
        "clickable-icon zt:w-6 zt:shrink-0 zt:[--icon-size:var(--icon-xs)] zt:group-data-[state=simple]/tree:text-sm zt:focus-visible:shadow-(--input-box-shadow-focus)",
      "chevron-icon":
        "zt:flex zt:size-(--icon-size) zt:items-center zt:justify-center zt:in-data-[expanded]:rotate-90",
      actions: "zt:flex zt:shrink-0 zt:items-center zt:gap-0.5",
      action:
        "clickable-icon zt:[--icon-size:var(--icon-xs)] zt:focus-visible:shadow-(--input-box-shadow-focus)",
      key: "zt:text-foreground",
      hint: "zt:text-muted-foreground zt:tabular-nums",
      placeholder: "zt:text-muted-foreground zt:italic",
      "color-swatch":
        "zt:rounded-xs zt:size-3 zt:shrink-0 zt:border zt:border-border",
      link: "zt:[overflow-wrap:anywhere] zt:text-link zt:underline zt:decoration-dotted zt:hover:decoration-solid",
      "long-toggle":
        "zt:rounded-xs zt:ms-0.5 zt:cursor-pointer zt:px-1 zt:text-muted-foreground zt:underline zt:decoration-dotted zt:underline-offset-2 zt:select-none zt:hover:bg-muted zt:hover:text-foreground zt:focus-visible:shadow-(--input-box-shadow-focus)",
      row: "zt:rounded-sm zt:flex zt:min-w-0 zt:items-start zt:gap-x-1 zt:px-1 zt:py-1 zt:group-data-[state=simple]/tree:py-2 zt:hover:bg-muted zt:focus-within:bg-muted zt:data-[state=matched]:bg-(--text-highlight-bg)",
      opaque:
        "zt:break-words zt:text-cyan zt:group-data-[state=simple]/tree:text-foreground",
      color:
        "zt:inline-flex zt:min-w-0 zt:items-center zt:gap-1 zt:text-green zt:group-data-[state=simple]/tree:text-foreground",
      string: "zt:text-green zt:group-data-[state=simple]/tree:text-foreground",
      number:
        "zt:tabular-nums zt:text-blue zt:group-data-[state=simple]/tree:text-foreground",
      boolean:
        "zt:text-purple zt:group-data-[state=simple]/tree:text-foreground",
      null: "zt:text-muted-foreground zt:italic",
      undefined: "zt:text-muted-foreground zt:italic",
      "long-text":
        "zt:line-clamp-3 zt:data-[state=expanded]:line-clamp-none zt:data-[state=expanded]:break-words zt:data-[state=expanded]:whitespace-pre-wrap",
    },
    startHere: {
      strip: "zt:mx-3 zt:my-2 zt:rounded-md zt:bg-card zt:p-3 zt:text-xs",
      heading: "zt:flex zt:items-center zt:justify-between zt:gap-2",
      line: cn(hint, "zt:mt-1"),
      dismiss: "",
    },
    editToolbar: {
      "edit-toolbar": cn(row, "zt:p-2"),
      "mode-group": row,
      "toolbar-actions": row,
      undo: "clickable-icon",
      redo: "clickable-icon",
    },
    select: {
      wrapper: "zt:min-w-0 zt:max-w-full",
      select: "dropdown zt:max-w-full",
      icon: "zt:hidden",
    },
    previewControls: {
      controls: cn(row, "zt:flex-wrap zt:text-sm"),
      label: cn(row, "zt:flex-wrap"),
      "label-text": "zt:text-muted-foreground",
      paused: "zt:text-sm zt:text-muted-foreground",
    },
    resultHeader: {
      header: "zt:flex zt:min-w-0 zt:flex-col zt:gap-2",
      heading: "zt-note-preview-heading",
      controls: cn(row, "zt:flex-wrap zt:text-sm"),
      label: cn(row, "zt:flex-wrap"),
      "label-text": "zt:text-muted-foreground",
    },
    resultRegion: {
      region: cn(
        stack,
        "zt:min-w-0 zt:rounded-md zt:border zt:border-border zt:bg-background zt:p-3 zt:select-text zt:focus-visible:outline-2 zt:focus-visible:outline-ring",
      ),
    },
    resultColumn: {
      label: cn(row, "zt:flex-wrap"),
      "label-text": "zt:text-muted-foreground",
      filename: "zt:text-sm",
      "filename-text": "zt:[overflow-wrap:anywhere]",
      problem: "zt:text-sm zt:text-(--text-error) zt:[overflow-wrap:anywhere]",
      "problem-heading": "zt:font-semibold",
      stale: "zt:text-sm zt:text-muted-foreground",
      pending: "zt:text-sm zt:text-muted-foreground",
      empty: "zt:text-sm zt:text-muted-foreground",
    },
    propertyList: {
      note: "zt:grid zt:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] zt:gap-x-3 zt:gap-y-2 zt:text-sm",
      list: "zt:grid zt:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] zt:gap-x-3 zt:gap-y-2 zt:text-sm",
      fold: "zt:grid zt:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] zt:gap-x-3 zt:gap-y-2 zt:text-sm",
      key: "zt:min-w-0 zt:text-muted-foreground zt:[overflow-wrap:anywhere]",
      value: "zt:min-w-0 zt:[overflow-wrap:anywhere]",
      empty: "zt:text-muted-foreground",
    },
    tabBar: {
      "tab-bar":
        "zt:flex zt:shrink-0 zt:flex-wrap zt:gap-1 zt:border-b zt:border-border zt:px-3 zt:pb-2",
      tab: "clickable-icon zt:shrink-0 zt:text-sm",
    },
    tabPanel: { "tab-panel": "zt:min-w-0 zt:p-3" },
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
      result: stack,
      heading: "zt-note-preview-heading zt:mb-2",
      "result-summary": "zt:cursor-pointer zt:text-sm zt:text-muted-foreground",
      "result-rows": "zt:mt-3 zt:flex zt:flex-col zt:gap-4",
      "result-row": "zt:min-w-0",
      "result-key":
        "zt:mb-2 zt:text-sm zt:font-semibold zt:[overflow-wrap:anywhere]",
      "result-empty": "zt:text-sm zt:text-muted-foreground",
      markdown:
        "zt:overflow-x-auto zt:whitespace-pre-wrap zt:[overflow-wrap:anywhere] zt:font-mono zt:text-sm zt:select-text",

      pane: stack,
      empty: hint,
      rows: "zt:flex zt:min-w-0 zt:flex-col zt:gap-2",
      row: "zt:min-w-0 zt:rounded-md zt:border zt:border-border zt:p-2",
      "row-header": "zt:flex zt:min-w-0 zt:flex-wrap zt:items-center zt:gap-1",
      "row-toggle":
        "clickable-icon zt:min-w-0 zt:flex-1 zt:flex-wrap zt:justify-start zt:gap-x-3 zt:gap-y-1 zt:text-start",
      "row-name": "zt:flex zt:min-w-0 zt:items-center zt:gap-2",
      key: "zt:font-medium zt:text-foreground zt:[overflow-wrap:anywhere]",
      label: "zt:text-sm",
      summary:
        "zt:min-w-0 zt:max-w-full zt:truncate zt:text-xs zt:text-muted-foreground",
      "row-actions":
        "zt:ms-auto zt:flex zt:shrink-0 zt:items-center zt:gap-0.5",
      edit: "clickable-icon",
      "row-action": "clickable-icon",
      actions,
      form: cn(stack, "zt:mt-3 zt:gap-4"),
      field,
      "name-input": "zt:w-full zt:min-w-0",
      "text-input": "zt:w-full zt:min-w-0",
      "field-group": field,
      "confirm-actions": actions,
      "expression-header": cn(actions, "zt:justify-between"),
      "format-label": "zt:min-w-0",
      "hidden-label": "zt:sr-only",
      "primary-action":
        "zt:inline-flex zt:items-center zt:gap-1.5 zt:whitespace-normal zt:text-start",
      "secondary-action":
        "zt:inline-flex zt:items-center zt:gap-1.5 zt:whitespace-normal zt:text-start",
      confirm: cn(stack, "zt:rounded-md zt:bg-card zt:p-3"),
      diagnostics: "zt:text-xs zt:text-error",
      hint,
      expression: cn(
        editorBox,
        "zt:flex zt:min-h-28 zt:min-w-0 zt:flex-1 zt:flex-col",
      ),
    },
    nameFolder: {
      "reset-button": "clickable-icon zt:ms-auto",
      "reset-label": "zt:sr-only",
      pane: cn(stack, "zt:gap-6"),
      group: stack,
      heading: "zt-profile-editor-heading",
      fields: stack,
      field,
      "binding-row":
        "zt:flex zt:min-w-0 zt:flex-wrap zt:items-center zt:gap-2 zt:py-2",
      "binding-heading":
        "zt:flex zt:min-w-0 zt:basis-full zt:flex-wrap zt:items-center zt:gap-2",
      "binding-label": "zt:font-medium",
      "binding-input": "zt:w-full zt:min-w-0",
      input: "zt:w-full zt:min-w-0",
      "readonly-input": "zt:w-full zt:min-w-0",
      "confirm-button": "zt:ms-auto",
      "toggle-row": row,
      "filename-editor": editorBox,
      "filename-result":
        "zt:flex zt:flex-wrap zt:gap-x-2 zt:gap-y-1 zt:text-xs",
      "filename-output": "zt:font-mono zt:[overflow-wrap:anywhere]",
      defaults: "zt:flex zt:flex-col zt:gap-2",
      "default-label": "zt:min-w-0 zt:flex-1",
      "default-value":
        "zt:min-w-0 zt:text-muted-foreground zt:[overflow-wrap:anywhere]",
      details: "zt:group/details",
      "details-icon": "zt:inline-flex zt:group-open/details:rotate-90",
      "identity-fields": cn(stack, "zt:pt-3"),
      "advanced-fields": cn(stack, "zt:gap-6 zt:pt-3"),
      actions,
      "confirmation-actions": actions,
      confirmation: cn(stack, "zt:rounded-md zt:bg-card zt:p-3"),
      help: hint,
      muted: hint,
      secondary: hint,
      summary:
        "zt:flex zt:cursor-(--cursor-clickable) zt:items-center zt:gap-2 zt:font-medium",
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
      problems: "zt:shrink-0 zt:p-3 zt:border-t zt:border-border zt:text-xs",
      "problems-heading": "zt:font-semibold",
      "problems-text": "zt:text-muted-foreground",
      "problems-recovery": "zt:text-muted-foreground",
    },
  },
};
