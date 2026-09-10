// Shared authoring controls inherit Obsidian's surfaces and editor typography.
import { templateHighlighting } from "@zotlit/workbench/language";
import type { WorkbenchTheme, WorkbenchIcon } from "@zotlit/workbench/ui";

import { Icon } from "@/components/obsidian/icon";
import { themeHook } from "@/lib/theme-hooks";
import { tv } from "@/lib/tw";
import { cn } from "@/lib/utils";

import { codePane } from "./editor-extension";

export const profileEditorIcons: Record<WorkbenchIcon, string> = {
  copy: "copy",
  confirm: "check",
  add: "plus",
  remove: "trash-2",
  close: "x",
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
  more: "ellipsis",
  "property-text": "text",
  "property-list": "list",
  "property-tags": "tags",
  "property-aliases": "forward",
  "property-number": "binary",
  "property-checkbox": "check-square",
  "property-date": "calendar",
  "property-datetime": "clock",
};
/** Text actions share the Match tab's outlined native control surface. */
export const profileEditorButton =
  "zt:inline-flex zt:items-center zt:gap-1.5 zt:whitespace-normal zt:text-start zt:text-muted-foreground";
/** Icons beside 12 px regular text carry the same optical weight. */
const captionIcon = "zt:[--icon-size:var(--icon-xs)] zt:[--icon-stroke:1.5]";
/** Every choose control shares the flat `clickable-icon` surface; `kind` sets its shape. */
export const selectionControl = tv({
  base: "clickable-icon",
  variants: {
    kind: {
      /** An icon-only action that sits beside a text trigger. */
      icon: cn("zt:shrink-0", captionIcon),
      /** A borderless text-and-icon control, subordinate to the result it changes. */
      trigger: cn(
        "zt-workbench-trigger zt:max-w-full zt:min-w-0 zt:gap-1.5 zt:text-start zt:leading-normal zt:[&_svg]:shrink-0",
        captionIcon,
      ),
      /** A choice that carries a hint under its label reads as two stacked lines. */
      option:
        "zt-workbench-option zt:min-w-0 zt:flex-col zt:gap-0.5 zt:text-start zt:leading-tight",
    },
  },
});
/**
 * A control row that names the selected data beside the control that changes it.
 * `placement` decides which part hides outside a sidebar: the whole row, or only the trigger.
 */
export const selectionBar = tv({
  slots: {
    row: "zt:min-w-0 zt:flex-wrap zt:items-center zt:gap-x-2 zt:gap-y-1",
    /** The selected data reads as a muted caption, subordinate to the result. */
    caption:
      "zt:min-w-0 zt:flex-1 zt:py-2 zt:text-xs zt:leading-normal zt:text-pretty zt:text-muted-foreground",
    trigger: [selectionControl({ kind: "trigger" }), "zt:ms-auto"],
  },
  variants: {
    placement: {
      /** The pane header always names the selection; only the trigger waits for a sidebar. */
      header: {
        row: "zt:flex zt:shrink-0 zt:px-3",
        trigger: "zt-workbench-sidebar-control zt:my-1",
      },
      /** A row inside the result appears only where Obsidian hides the view header. */
      sidebar: { row: "zt-workbench-sidebar-control" },
    },
  },
});
/** A group of selection choices: its heading, then its options. */
export const selectionGroup = "zt:flex zt:min-w-0 zt:flex-col zt:gap-0.5";
/** A group heading names the source the options beneath it come from. */
export const selectionGroupHeading =
  "zt:mb-1.5 zt:px-1.5 zt:text-xs zt:font-semibold zt:leading-normal zt:text-muted-foreground";
const row = "zt:flex zt:items-center zt:gap-2";
const stack = "zt:flex zt:min-w-0 zt:flex-col zt:gap-3";
const field = "zt:flex zt:min-w-0 zt:flex-col zt:gap-1.5";
const actions = "zt:flex zt:flex-wrap zt:items-center zt:gap-2";
const hint =
  "zt:text-xs zt:leading-normal zt:text-muted-foreground zt:text-pretty";
/** Guidance and status read at hint size wherever the selection UI states a task. */
export const selectionHint = hint;
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
  editorExtension: () => [templateHighlighting, codePane],
  classes: {
    match: {
      "remove-button": "mod-destructive zt:shrink-0 zt:[--input-shadow:none]",
      button: profileEditorButton,
      "icon-button": "clickable-icon zt:shrink-0",
      input:
        "zt:min-h-(--input-height) zt:min-w-0 zt:w-full zt:flex-auto zt:shrink-0",
      "chip-input":
        "zt:[field-sizing:content] zt:w-auto zt:max-w-full zt:min-w-[2ch] zt:flex-none zt:[--background-modifier-form-field:transparent] zt:[--input-padding:0px]",
      "chip-item": "zt:flex zt:min-w-0 zt:max-w-full zt:flex-col",
      "chip-line": "metadata-property-value zt:min-w-0",
      "chip-value": "multi-select-pill-content",
      "chip-remove": "multi-select-pill-remove-button clickable-icon",
      hint: "zt:pb-1 zt:text-xs zt:leading-normal zt:text-pretty zt:text-muted-foreground",
      pane: cn(
        "zt:flex zt:min-w-0 zt:flex-col zt:gap-4 zt:text-sm",
        "zt:[--icon-size:var(--icon-s)] zt:[--icon-stroke:var(--icon-s-stroke-width)]",
        "zt:[&>p]:text-xs zt:[&>p]:leading-normal zt:[&>p]:text-pretty zt:[&>p]:text-muted-foreground",
      ),
      fieldset:
        "zt:flex zt:min-w-0 zt:flex-col zt:items-start zt:gap-4 zt:border-0 zt:p-0",
      group:
        "zt:flex zt:min-w-0 zt:w-full zt:flex-1 zt:flex-col zt:gap-2 zt:data-[state=nested]:rounded-md zt:data-[state=nested]:border zt:data-[state=nested]:border-border zt:data-[state=nested]:bg-card zt:data-[state=nested]:p-2 zt:[&>[data-part=actions]:first-child]:justify-between",
      rows: "zt:flex zt:flex-col zt:gap-2 zt:list-none zt:m-0 zt:p-0",
      row: "zt:grid zt:min-w-0 zt:grid-cols-[4.5rem_minmax(0,1fr)] zt:items-start zt:gap-2 zt:[&>[data-part=group]]:col-span-2",
      condition: "zt:col-start-2 zt:min-w-0",
      statement: cn(
        "zt:flex zt:min-w-0 zt:items-start zt:overflow-hidden zt:rounded-md zt:bg-input zt:ring-1 zt:ring-border-hover zt:focus-within:ring-2 zt:focus-within:ring-border-focus",
        "zt:[--dropdown-background-hover:var(--background-modifier-form-field-hover)] zt:[--dropdown-background:var(--background-modifier-form-field)] zt:[--input-border-width-focus:0px] zt:[--input-border-width:0px] zt:[--input-radius:0px] zt:[--input-shadow:none]",
        "zt:[&_[data-part=wrapper]>select]:[field-sizing:content] zt:[&_[data-part=wrapper]>select]:w-full zt:[&:has([aria-invalid=true])]:ring-(--background-modifier-error)",
        "zt:[&>[data-part=actions]]:h-(--input-height) zt:[&>[data-part=actions]]:shrink-0 zt:[&>[data-part=actions]]:flex-nowrap zt:[&>[data-part=actions]]:gap-0 zt:[&>[data-part=actions]]:px-0.5",
      ),
      fields:
        "zt:flex zt:min-w-0 zt:flex-1 zt:flex-wrap zt:items-stretch zt:overflow-hidden",
      predicate:
        "zt:flex zt:min-w-0 zt:max-w-full zt:[&>[data-part=wrapper]:nth-child(2)]:border-s zt:[&>[data-part=wrapper]]:border-border",
      value: cn(
        "zt:-ms-px zt:-mt-px zt:flex zt:max-w-full zt:min-w-0 zt:flex-auto zt:items-start zt:border-s zt:border-t zt:border-border zt:empty:hidden",
        "zt:[&>:is([data-part=input],div[data-part=control])]:w-[12ch] zt:[&>:not([data-part=actions],datalist)]:flex-auto",
      ),
      actions: "zt:flex zt:flex-wrap zt:items-center zt:gap-2",
      control:
        "zt:min-w-0 zt:max-w-full zt:[div&]:flex zt:[div&]:flex-col zt:[span&]:px-2 zt:[span&]:pb-1 zt:[span&]:text-xs zt:[span&]:leading-normal zt:[span&]:text-muted-foreground",
      chips:
        "zt:flex zt:min-h-(--input-height) zt:min-w-0 zt:w-max zt:flex-wrap zt:items-start zt:gap-x-1.5 zt:px-2 zt:[--metadata-divider-width:0px] zt:[--metadata-input-font-size:var(--font-ui-small)] zt:[--metadata-input-text-color:var(--text-normal)]",
      chip: "multi-select-pill",
      expression:
        "zt:min-w-0 zt:w-full zt:font-mono zt:text-sm zt:leading-normal zt:[field-sizing:content] zt:resize-y",
      conjunction:
        "zt:flex zt:min-h-(--input-height) zt:items-center zt:justify-end zt:text-end zt:text-sm zt:text-muted-foreground zt:[overflow-wrap:anywhere]",
      result: "zt:text-xs zt:leading-normal zt:text-muted-foreground",
      error:
        "zt:pt-1 zt:text-xs zt:leading-normal zt:text-pretty zt:text-(--text-error)",
    },
    dataExplorer: {
      hint: "setting-item-description zt:px-3 zt:pb-2",
      "root-label": "zt:text-xs zt:text-muted-foreground",
      explorer:
        "zt-template-data-explorer zt:flex zt:min-h-0 zt:min-w-0 zt:flex-1 zt:flex-col zt:gap-3 zt:pt-3",
      /** The native title already names the item and the Fields role in a full pane; the heading reads only where a sidebar hides that title. */
      header:
        "zt-workbench-sidebar-control zt:items-center zt:justify-between zt:gap-x-2 zt:px-3",
      heading: "",
      search: "zt:mx-3 zt:w-auto zt:min-w-0 zt:shrink-0",
      body: "zt:min-h-0 zt:flex-1 zt:overflow-auto zt:px-2 zt:pb-3",
      empty:
        "zt:px-1 zt:py-3 zt:text-muted-foreground zt:text-sm zt:leading-normal",
    },
    explorerTree: {
      sections: "zt:flex zt:flex-col zt:gap-2",
      section: "",
      "section-header":
        "clickable-icon zt:[--icon-size:var(--icon-xs)] zt:text-muted-foreground zt:focus-visible:shadow-(--input-box-shadow-focus)",
      "section-chevron":
        "zt:flex zt:size-(--icon-size) zt:shrink-0 zt:items-center zt:justify-center",
      "section-label": "zt:min-w-0 zt:flex-1 zt:text-start",
      "section-count": "zt:font-normal zt:tabular-nums zt:text-faint",
      tree: "zt:text-xs zt:leading-normal",
      spacer: "zt:w-6 zt:shrink-0",
      /** Key and value share one line while both fit; a longer value drops to its own line beneath the key. */
      contents:
        "zt:flex zt:min-w-0 zt:flex-1 zt:flex-wrap zt:gap-x-1.5 zt:select-text zt:[overflow-wrap:anywhere]",
      group:
        "zt:ms-2.5 zt:border-s zt:border-(--nav-indentation-guide-color) zt:ps-2",
      chevron:
        "clickable-icon zt:w-6 zt:shrink-0 zt:[--icon-size:var(--icon-xs)] zt:focus-visible:shadow-(--input-box-shadow-focus)",
      "chevron-icon":
        "zt:flex zt:size-(--icon-size) zt:items-center zt:justify-center zt:in-data-[expanded]:rotate-90",
      /** Revealed by hover or focus; a touch device has neither, so it keeps them visible. */
      actions:
        "zt:flex zt:shrink-0 zt:items-center zt:gap-0.5 zt:opacity-0 zt:group-hover/row:opacity-100 zt:group-focus-within/row:opacity-100 zt:[.is-mobile_&]:opacity-100",
      action:
        "clickable-icon zt:[--icon-size:var(--icon-xs)] zt:focus-visible:shadow-(--input-box-shadow-focus)",
      key: "zt:font-mono zt:text-foreground zt:data-[state=labeled]:font-sans zt:data-[state=labeled]:font-medium",
      value: "zt:min-w-0",
      hint: "zt:text-muted-foreground zt:tabular-nums",
      placeholder: "zt:text-muted-foreground zt:italic",
      "color-swatch":
        "zt:rounded-xs zt:size-3 zt:shrink-0 zt:border zt:border-border",
      link: "zt:[overflow-wrap:anywhere] zt:text-link zt:underline zt:decoration-dotted zt:hover:decoration-solid",
      "long-toggle":
        "zt:rounded-xs zt:ms-0.5 zt:cursor-pointer zt:px-1 zt:text-muted-foreground zt:underline zt:decoration-dotted zt:underline-offset-2 zt:select-none zt:hover:bg-muted zt:hover:text-foreground zt:focus-visible:shadow-(--input-box-shadow-focus)",
      row: "zt:group/row zt:rounded-sm zt:flex zt:min-w-0 zt:items-start zt:gap-x-1 zt:px-1 zt:py-1 zt:hover:bg-muted zt:focus-within:bg-muted zt:data-[state=matched]:bg-(--text-highlight-bg)",
      opaque: "zt:break-words zt:text-cyan",
      color: "zt:inline-flex zt:min-w-0 zt:items-center zt:gap-1 zt:text-green",
      string: "zt:text-green",
      number: "zt:tabular-nums zt:text-blue",
      boolean: "zt:text-purple",
      null: "zt:text-muted-foreground zt:italic",
      undefined: "zt:text-muted-foreground zt:italic",
      "long-text":
        "zt:line-clamp-3 zt:data-[state=expanded]:line-clamp-none zt:data-[state=expanded]:break-words zt:data-[state=expanded]:whitespace-pre-wrap",
    },
    editToolbar: {
      "edit-toolbar": cn(row, "zt:p-2"),
      mode: profileEditorButton,
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
        "zt:min-w-0 zt:rounded-sm zt:select-text zt:focus-visible:outline-2 zt:focus-visible:outline-ring",
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
      behind:
        "zt:flex zt:min-w-0 zt:flex-wrap zt:items-center zt:gap-x-3 zt:gap-y-1 zt:border-s-2 zt:border-(--interactive-accent) zt:bg-(--background-secondary) zt:px-3 zt:py-2 zt:text-xs zt:leading-normal zt:text-muted-foreground",
      "behind-text": "zt:min-w-0 zt:flex-1 zt:text-pretty",
      run: cn(profileEditorButton, "zt:ms-auto zt:shrink-0"),
      pending: "zt:text-sm zt:text-muted-foreground",
      empty: "zt:text-sm zt:text-muted-foreground",
    },
    propertyList: {
      /** The note's own Properties list sits in the app's container, which the preview supplies. */
      note: "metadata-properties",
      list: "metadata-properties",
      spread: "metadata-properties",
      row: "metadata-property",
      key: "metadata-property-key",
      icon: "metadata-property-icon",
      label: "metadata-property-key-input",
      value: "metadata-property-value",
      text: "metadata-input-longtext",
      pills: "multi-select-container",
      pill: "multi-select-pill",
      "pill-text": "multi-select-pill-content",
      checkbox: "metadata-input-checkbox",
      empty: "metadata-input-longtext",
    },
    tabBar: {
      "tab-bar":
        "zt:flex zt:shrink-0 zt:flex-wrap zt:gap-1 zt:border-b zt:border-border zt:px-3 zt:pb-2",
      tab: "clickable-icon zt:disabled:opacity-50 zt:shrink-0 zt:text-sm",
    },
    tabPanel: {
      "tab-panel": "zt:min-w-0 zt:p-3",
      description: cn(hint, "zt:mb-3"),
    },
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
      empty: hint,
      rows: "zt:flex zt:min-w-0 zt:flex-col zt:gap-2",
      row: "zt:min-w-0 zt:rounded-md zt:border zt:border-border zt:p-2",
      "row-header": "zt:flex zt:min-w-0 zt:flex-wrap zt:items-center zt:gap-1",
      "row-toggle":
        "clickable-icon zt:min-w-0 zt:flex-1 zt:flex-wrap zt:justify-start zt:gap-x-3 zt:gap-y-1 zt:text-start",
      "row-name": "zt:flex zt:min-w-0 zt:items-center zt:gap-2",
      key: "zt:font-medium zt:text-foreground zt:[overflow-wrap:anywhere]",
      label: "zt:text-xs zt:font-medium",
      summary:
        "zt:min-w-0 zt:max-w-full zt:truncate zt:text-xs zt:text-muted-foreground",
      "row-actions":
        "zt:ms-auto zt:flex zt:shrink-0 zt:items-center zt:gap-0.5",
      edit: "clickable-icon",
      "row-action": "clickable-icon",
      actions,
      form: cn(stack, "zt:mt-3 zt:px-(--size-2-3)"),
      field: cn(field, "zt:text-xs zt:font-medium"),
      "name-input": "zt:w-full zt:min-w-0 zt:font-normal",
      "text-input": "zt:w-full zt:min-w-0 zt:font-normal",
      "field-group": field,
      "confirm-actions": actions,
      "expression-header": cn(actions, "zt:justify-start"),
      "format-label": "zt:min-w-0 zt:max-w-full",
      "hidden-label": "zt:sr-only",
      "primary-action": profileEditorButton,
      "secondary-action": profileEditorButton,
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
      "confirm-button": cn(profileEditorButton, "zt:ms-auto"),
      "cancel-button": profileEditorButton,
      "source-button": profileEditorButton,
      "toggle-row": row,
      "filename-editor": editorBox,
      "filename-result":
        "zt:flex zt:flex-wrap zt:items-center zt:gap-x-2 zt:gap-y-1 zt:text-xs zt:leading-normal",
      "filename-output": "zt:min-w-0 zt:[overflow-wrap:anywhere]",
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
      "primary-action": cn(profileEditorButton, "zt:ms-auto"),
      "section-go": cn(profileEditorButton, "zt:ms-auto"),
    },
    sampleSuggester: {
      suggester: "zt:flex zt:min-w-0 zt:flex-1 zt:items-center zt:gap-2",
      label:
        "zt:min-w-0 zt:flex-1 zt:truncate zt:text-xs zt:text-muted-foreground",
      trigger: selectionControl({ kind: "icon" }),
      "text-trigger": selectionControl({
        kind: "trigger",
        className: "zt:shrink-0",
      }),
    },
    problemsFooter: {
      "problems-open": profileEditorButton,
      problems: "zt:shrink-0 zt:p-3 zt:border-t zt:border-border zt:text-xs",
      "problems-heading": "zt:font-semibold",
      "problems-text": "zt:text-muted-foreground",
      "problems-recovery": "zt:text-muted-foreground",
    },
  },
};
