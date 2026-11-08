import { EditorView } from "@codemirror/view";
import {
  Braces,
  Pin,
  PinOff,
  Copy,
  Check,
  Code2,
  Plus,
  Trash2,
  X,
  ArrowUp,
  ArrowDown,
  Search,
  Eye,
  Pencil,
  List,
  Redo2,
  RotateCcw,
  Undo2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Ellipsis,
  TextAlignStart,
  Tags,
  Forward,
  Binary,
  SquareCheck,
  Calendar,
  Clock,
  CircleHelp,
  GripVertical,
  TextCursorInput,
  CornerDownRight,
  LayoutList,
  BookMarked,
  Fingerprint,
  Paperclip,
  FolderTree,
  Link,
  Database,
  Highlighter,
  FileText,
  Quote,
} from "lucide-react";
// The web's look for the Workbench UI: the site's Tailwind classes for each
// part of the shared tree, and Lucide for its icons. The tree carries no class
// of its own (ADR 0044); the control sizes are the kit's Workbench variants.

import type { WorkbenchIcon, WorkbenchTheme } from "@zotlit/workbench/ui";

import { buttonVariants } from "@/components/ui/button";
import { inputVariants } from "@/components/ui/input";
import { cn } from "@/lib/cn";

import { editorTheme } from "./editor-theme";
import {
  webExpressionCompletion,
  webExpressionList,
} from "./expression-completion";

const ICON: Record<WorkbenchIcon, typeof List> = {
  "chevron-right": ChevronRight,
  more: Ellipsis,
  copy: Copy,
  help: CircleHelp,
  confirm: Check,
  add: Plus,
  remove: Trash2,
  close: X,
  "move-up": ArrowUp,
  "move-down": ArrowDown,
  "choose-sample": Search,
  "chevron-up": ChevronUp,
  error: CircleAlert,
  "chevron-down": ChevronDown,
  preview: Eye,
  edit: Pencil,
  basic: List,
  advanced: Code2,
  undo: Undo2,
  redo: Redo2,
  reset: RotateCcw,
  "property-text": TextAlignStart,
  "property-list": List,
  "property-tags": Tags,
  "property-aliases": Forward,
  "property-number": Binary,
  "property-checkbox": SquareCheck,
  "property-date": Calendar,
  "property-datetime": Clock,
  drag: GripVertical,
  "expand-all": ChevronsUpDown,
  "collapse-all": ChevronsDownUp,
  fields: Braces,
  insert: TextCursorInput,
  result: CornerDownRight,
  pin: Pin,
  unpin: PinOff,
  "section-common": LayoutList,
  "section-reference": BookMarked,
  "section-identifiers": Fingerprint,
  "section-content": Paperclip,
  "section-organization": FolderTree,
  "section-links": Link,
  "section-record": Database,
  "section-annotation": Highlighter,
  "section-source": FileText,
  "section-citation": Quote,
};

/** A read-only Properties block: one row per property, key beside value. */
const propertyGrid = "@container flex min-w-0 flex-col gap-y-0.5 text-xs";

const historyButton = buttonVariants({ variant: "ghost", size: "icon-sm" });

const nameInput = inputVariants({ size: "xs" });

/** One card per row of the note path and binding groups. */
const nameRow =
  "flex flex-col gap-2 rounded-md border border-fd-border bg-fd-card px-2.5 py-2";

/**
 * The width each column's handle takes between the column and the editor,
 * in pixels: the `w-3` of the `edge` part below. The placement counts it.
 */
export const PANEL_HANDLE_WIDTH = 12;

export const WEB_THEME: WorkbenchTheme = {
  editorExtension: (slice, language) => [
    editorTheme,
    ...(slice === "filename" ||
    language === "expression" ||
    language === "json-e"
      ? [EditorView.theme({ ".cm-content": { minHeight: "5rem" } })]
      : []),
  ],
  expressionExtension: webExpressionList,
  expressionCompletion: webExpressionCompletion,
  classes: {
    match: {
      "remove-button": cn(
        buttonVariants({ variant: "outline", size: "xs" }),
        "text-destructive hover:text-destructive",
      ),
      button: buttonVariants({ variant: "outline", size: "xs" }),
      "icon-button": buttonVariants({ variant: "ghost", size: "icon-xs" }),
      input: cn(nameInput, "min-w-0 flex-1"),
      "chip-input": cn(nameInput, "w-12 min-w-12 flex-1"),
      "chip-value": "min-w-0 [overflow-wrap:anywhere]",
      "chip-item": "flex min-w-0 max-w-full flex-col",
      "chip-line": "contents",
      "chip-remove": buttonVariants({ variant: "ghost", size: "icon-xs" }),
      hint: "text-xs text-fd-muted-foreground",

      pane: "flex min-w-0 flex-col gap-3",
      fieldset: "min-w-0 border-0 p-0",
      group:
        "flex min-w-0 flex-1 flex-col gap-2 rounded-md border border-fd-border p-2 data-[state=root]:border-0 data-[state=root]:p-0 [&>[data-part=actions]:first-child]:justify-between data-[drop=into]:ring-2 data-[drop=into]:ring-fd-primary",
      rows: "flex flex-col gap-2 list-none m-0 p-0",
      row: "grid min-w-0 grid-cols-[auto_4.5rem_minmax(0,1fr)] items-start gap-2 [&>[data-part=group]]:col-span-2 data-dragging:opacity-50 [&:hover>[data-part=handle]]:opacity-100 data-[drop=before]:shadow-[0_calc(var(--spacing)*-0.5)_0_0_var(--color-fd-primary)] data-[drop=after]:shadow-[0_calc(var(--spacing)*0.5)_0_0_var(--color-fd-primary)]",
      handle:
        "flex min-h-8 min-w-6 shrink-0 items-center justify-center -me-1 rounded-sm text-fd-muted-foreground cursor-grab active:cursor-grabbing opacity-0 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-fd-ring aria-disabled:hidden [&_svg]:size-4",
      condition: "min-w-0 flex-1",
      statement:
        "flex flex-wrap min-w-0 items-start gap-1 [&_[data-part=wrapper]]:w-auto",
      predicate: "contents",
      fields: "contents",
      value: "contents",
      actions: "flex flex-wrap items-center gap-2",
      control: "min-w-0 max-w-full",
      chips: "flex flex-1 min-w-0 flex-wrap items-center gap-1",
      chip: "inline-flex min-w-0 items-center gap-1 rounded-sm border border-fd-border px-1",
      expression: cn(
        nameInput,
        "[field-sizing:content] min-w-0 flex-1 resize-y font-mono",
        // The editor inside draws no outline; this box shows the focus.
        "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-fd-ring",
      ),
      conjunction:
        "flex min-h-8 items-center justify-end text-end text-xs [overflow-wrap:anywhere]",
      result: "text-sm",
      error: "text-xs",
    },
    dataExplorer: {
      hint: "text-xs text-fd-muted-foreground",
      "root-label": "text-xs text-fd-muted-foreground me-auto",
      explorer: "flex min-h-0 flex-1 flex-col gap-2 p-2",
      header: "flex flex-wrap items-center justify-between gap-2",
      heading: "text-xs font-semibold",
      "search-row": "flex items-center gap-1",
      search:
        "h-7 min-w-0 flex-1 rounded-md border border-fd-border bg-fd-background px-2 text-xs placeholder:text-fd-muted-foreground focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-fd-ring",
      "sections-toggle": cn(historyButton, "shrink-0"),
      /** Never shorter than a sticky section header and one whole row. */
      body: "min-h-18 flex-1 overflow-auto overscroll-contain",
      "keys-hint":
        "-mx-2 -mb-2 shrink-0 border-t border-fd-border px-3 py-1.5 text-xs text-fd-muted-foreground",
      empty: "text-fd-muted-foreground text-xs",
    },
    explorerTree: {
      sections: "flex flex-col gap-2",
      section: "",
      /** Stays at the top while its section scrolls past, on the panel's ground. */
      "section-heading": "sticky top-0 z-10 bg-fd-card",
      "section-header":
        "flex w-full cursor-pointer items-center gap-1 rounded px-1 py-1 text-start text-xs font-semibold text-fd-muted-foreground hover:bg-fd-muted hover:text-fd-foreground aria-disabled:cursor-default",
      "section-icon":
        "flex size-3 shrink-0 text-fd-muted-foreground [&_svg]:size-3",
      "section-chevron":
        "ms-auto flex size-3 shrink-0 items-center justify-center transition-transform duration-100 ease-out data-[expanded]:rotate-90 motion-reduce:transition-none",
      "section-label": "min-w-0 truncate",
      "section-count": "font-normal tabular-nums text-fd-muted-foreground",
      tree: "text-xs leading-relaxed",
      spacer: "mt-[3px] size-3 shrink-0",
      /** Key and value share one line while both fit; a longer value drops to its own line beneath the key. */
      contents:
        "flex min-w-0 flex-1 flex-wrap gap-x-1.5 select-text [overflow-wrap:anywhere] data-[state=line]:cursor-pointer data-[state=line]:items-center data-[state=line]:self-stretch data-[state=line]:flex-nowrap data-[state=line]:overflow-hidden data-[state=line]:whitespace-nowrap data-[state=line]:*:data-[part=value]:truncate",
      /**
       * A Fields Panel row's label, from the section icon's edge, with the
       * chevron of a field that opens after it. A nested field's label
       * stands a little in, behind the guide line its siblings continue.
       */
      "field-label":
        "flex w-2/5 min-w-0 shrink-0 items-center gap-1 self-stretch *:data-[part=chevron]:mt-0 *:data-[part=key]:truncate data-[state=nested]:ms-1 data-[state=nested]:border-s data-[state=nested]:border-fd-border data-[state=nested]:ps-2",
      group:
        "ms-3 border-s border-fd-border ps-2 data-[state=line]:ms-0 data-[state=line]:border-0 data-[state=line]:ps-0 data-[state=line]:in-data-[part=group]:ps-3",
      chevron:
        "mt-[3px] flex size-3 shrink-0 cursor-pointer items-center justify-center text-fd-muted-foreground transition-transform duration-100 ease-out hover:text-fd-foreground data-[expanded]:rotate-90",
      "chevron-icon": "size-3 [&_svg]:size-3",
      actions:
        "absolute top-0.5 end-0 flex items-center gap-0.5 bg-linear-to-l from-fd-background from-60% to-transparent ps-6 group-data-line:static group-data-line:bg-none group-data-line:ps-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 group-data-selected:opacity-100 group-data-open:opacity-100 [@media(hover:none)]:opacity-100",
      action:
        "rounded-xs flex size-4 cursor-pointer items-center justify-center text-fd-muted-foreground hover:bg-fd-muted hover:text-fd-foreground",
      key: "font-mono text-fd-foreground data-[state=labeled]:font-sans data-[state=labeled]:font-medium",
      value: "min-w-0",
      hint: "text-fd-muted-foreground",
      placeholder: "text-fd-muted-foreground italic",
      "color-swatch": "rounded-xs size-3 shrink-0 border border-fd-border",
      link: "break-all text-fd-primary underline decoration-dotted hover:decoration-solid",
      "long-toggle":
        "rounded-xs ms-0.5 cursor-pointer px-1 text-fd-muted-foreground underline decoration-dotted underline-offset-2 select-none hover:bg-fd-muted hover:text-fd-foreground",
      // The row ↑/↓ selected wears a ring that hover never shows.
      row: "group rounded relative flex min-w-0 items-start gap-x-1 px-0.5 data-line:h-7 data-line:items-center data-line:px-1 hover:bg-fd-muted data-[state=matched]:bg-fd-accent data-selected:bg-fd-muted data-selected:ring-1 data-selected:ring-inset data-selected:ring-fd-ring data-open:bg-fd-accent",
      opaque: "break-words text-cyan-700 dark:text-cyan-400",
      color:
        "inline-flex min-w-0 items-center gap-1 text-emerald-700 dark:text-emerald-400",
      string: "text-emerald-700 dark:text-emerald-400",
      number: "text-blue-700 dark:text-blue-400",
      boolean: "text-purple-700 dark:text-purple-400",
      null: "text-fd-muted-foreground italic",
      undefined: "text-fd-muted-foreground italic",
      "long-text":
        "data-[state=expanded]:break-words data-[state=expanded]:whitespace-pre-wrap",
    },
    nameFolder: {
      "reset-button": buttonVariants({ variant: "outline", size: "xs" }),
      "source-button": cn(
        buttonVariants({ variant: "outline", size: "xs" }),
        "mt-2",
      ),
      "confirm-button": buttonVariants({ variant: "outline", size: "xs" }),
      "cancel-button": buttonVariants({ variant: "ghost", size: "xs" }),
      unreadable: "text-sm text-fd-muted-foreground",
      pane: "-m-1 flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-1 pb-3",
      "filename-editor": "rounded-md border border-fd-border bg-fd-card",
      help: "text-xs leading-normal text-pretty text-fd-muted-foreground",
      "filename-result":
        "flex flex-wrap items-center gap-2 text-xs leading-normal",
      muted: "text-fd-muted-foreground",
      "filename-status":
        "flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 data-[state=failed]:text-fd-destructive",
      "filename-output": "min-w-0 [overflow-wrap:anywhere]",
      defaults: "flex flex-col gap-1.5 text-xs",
      actions: "flex flex-wrap items-center gap-2",
      "default-label": "min-w-0 flex-1",
      "default-value": "font-mono",
      secondary: "text-xs text-fd-muted-foreground",
      details:
        "group rounded-md border border-fd-border bg-fd-card px-2.5 py-2",
      summary:
        "flex min-h-7 cursor-pointer list-none items-center gap-1.5 text-xs font-semibold [&::-webkit-details-marker]:hidden",
      "details-icon":
        "size-3.5 shrink-0 text-fd-muted-foreground transition-transform group-open:rotate-90 [&_svg]:size-full",
      "identity-fields": "mt-2 flex flex-col gap-3 pb-1",
      "advanced-fields": "mt-2 flex flex-col gap-4 pb-1",
      fields: "flex flex-col gap-3",
      "readonly-input": cn(
        nameInput,
        "flex-1 bg-fd-background font-mono text-fd-muted-foreground",
      ),
      group: "flex flex-col gap-2",
      heading: "text-xs font-semibold",
      field: "flex flex-col gap-1 text-xs font-medium",
      "binding-row": nameRow,
      "path-row": nameRow,
      "binding-heading": "flex min-h-8 flex-wrap items-center gap-2",
      "binding-label": "min-w-0 flex-1 text-xs font-medium",
      "toggle-row": "flex min-h-8 items-center gap-2 text-xs",
      confirmation:
        "flex flex-col gap-2 border-s-2 border-fd-primary bg-fd-accent/40 px-3 py-2 text-xs leading-normal",
      strong: "font-semibold",
      prose: "text-pretty",
      "confirmation-actions": "flex flex-wrap gap-2",
      input: nameInput,
      "binding-input": cn(
        nameInput,
        "bg-fd-background disabled:text-fd-muted-foreground",
      ),
      switch:
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-fd-muted-foreground/60 after:absolute after:inset-x-0 after:-inset-y-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring data-[state=checked]:border-fd-primary data-[state=checked]:bg-fd-primary data-[state=unchecked]:bg-fd-muted disabled:cursor-default disabled:opacity-50",
      "switch-thumb":
        "pointer-events-none block size-5 rounded-full bg-fd-background shadow-sm data-[state=checked]:translate-x-5 rtl:data-[state=checked]:-translate-x-5 data-[state=unchecked]:translate-x-0.5 rtl:data-[state=unchecked]:-translate-x-0.5",
    },
    properties: {
      pane: "flex min-h-0 flex-1 flex-col gap-3 overflow-auto pb-3",
      empty:
        "rounded-md border border-dashed border-fd-border p-3 text-xs leading-normal text-pretty text-fd-muted-foreground",
      rows: "flex flex-col gap-2",
      row: "rounded-md border border-fd-border bg-fd-card",
      "row-header": "grid grid-cols-[minmax(0,1fr)_auto] px-2.5 py-1.5",
      "row-toggle":
        "col-span-2 col-start-1 row-start-1 grid min-w-0 cursor-pointer grid-cols-subgrid rounded-md text-start",
      "row-name":
        "col-start-1 row-start-1 flex min-h-7 min-w-0 items-center gap-2 pe-2",
      key: "min-w-0 flex-1 font-mono text-sm font-medium break-words",
      label: "text-xs font-medium data-[state=problem]:text-destructive",
      "row-actions":
        "z-10 col-start-2 row-start-1 flex items-center gap-0.5 self-start",
      edit: cn(
        buttonVariants({ variant: "ghost", size: "icon-xs" }),
        "aria-pressed:bg-fd-muted",
      ),
      actions: "flex flex-wrap items-center gap-2",
      form: "flex flex-col gap-3 border-t border-fd-border p-2.5",
      field: "flex flex-col gap-1 text-xs font-medium",
      "name-input": cn(nameInput, "bg-fd-background font-mono"),
      hint: "text-xs leading-normal text-pretty text-fd-muted-foreground",
      "field-group": "flex flex-col gap-1.5",
      "expression-header":
        "flex min-h-8 flex-wrap items-center justify-between gap-2",
      "format-label": "flex min-w-0 items-center gap-2 text-xs",
      "hidden-label": "sr-only",
      confirm:
        "flex flex-col gap-2 border-s-2 border-fd-primary bg-fd-accent/40 px-3 py-2 text-xs leading-normal",
      text: "text-pretty",
      "confirm-actions": "flex flex-wrap gap-2",
      "text-input": cn(nameInput, "bg-fd-background"),
      expression:
        "flex min-h-28 flex-col rounded-md border border-fd-border bg-fd-background data-[state=problem]:border-destructive",
      diagnostics:
        "flex flex-col gap-1 border-s-2 border-s-destructive ps-3 text-xs leading-normal text-pretty text-destructive",
      summary:
        "col-span-2 col-start-1 row-start-2 block min-w-0 text-xs leading-normal break-words text-fd-muted-foreground data-[state=closed]:line-clamp-2 data-[state=problem]:line-clamp-2 data-[state=problem]:text-destructive",
      "row-action": buttonVariants({ variant: "ghost", size: "icon-xs" }),
      "primary-action": buttonVariants({ variant: "outline", size: "xs" }),
      "secondary-action": buttonVariants({ variant: "ghost", size: "xs" }),
    },
    annotation: {
      "help-bar": "mb-3 shrink-0 leading-normal",
      "help-button": buttonVariants({ variant: "ghost", size: "icon-xs" }),
      "help-lede": "text-xs text-pretty text-fd-muted-foreground",
      "help-toggle": "ms-1 inline-block align-baseline",
      help: "mb-3 flex max-h-40 shrink-0 flex-col gap-1 overflow-auto text-xs leading-normal text-fd-muted-foreground focus-visible:outline-2 focus-visible:outline-fd-ring",

      // The inline Note-tab chooser keeps its own space; the compact
      // trigger sits in the item row, which spaces its controls.
      "sample-bar":
        "flex shrink-0 items-center gap-2 data-[state=labelled]:mb-2",
      problem:
        "mb-2 border-s-2 border-fd-primary bg-fd-accent/40 px-3 py-2 text-xs leading-normal text-pretty",
      pane: "flex min-h-0 flex-1 flex-col rounded-md border border-fd-border bg-fd-card",
      pointer:
        "mt-2 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-fd-border bg-fd-card px-2.5 py-1.5 text-xs leading-normal",
      heading: "font-semibold",
      hint: "text-pretty text-fd-muted-foreground",
      "section-bar":
        "mb-2 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-fd-border bg-fd-card px-2.5 py-1.5 text-xs leading-normal",
      "primary-action": cn(
        buttonVariants({ variant: "outline", size: "xs" }),
        "ms-auto",
      ),
      "section-go": cn(
        buttonVariants({ variant: "ghost", size: "xs" }),
        "ms-auto",
      ),
    },
    sampleSuggester: {
      suggester: "flex min-w-0 flex-1 items-center gap-2",
      label: "min-w-0 flex-1 truncate text-xs",
      trigger: buttonVariants({ variant: "ghost", size: "icon-2xs" }),
      "text-trigger": cn(
        buttonVariants({ variant: "ghost", size: "2xs" }),
        "max-w-full rounded-sm text-start leading-normal font-normal whitespace-normal text-fd-muted-foreground hover:text-fd-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring [&_svg]:[stroke-width:1.5]",
      ),
    },

    select: {
      wrapper: "relative w-full min-w-0 has-[select:disabled]:opacity-50",
      select:
        "min-h-8 w-full min-w-0 appearance-none rounded-md border border-fd-border bg-fd-card py-1 ps-2 pe-7 text-base hover:bg-fd-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring disabled:cursor-default aria-invalid:border-fd-foreground sm:text-xs",
      icon: "pointer-events-none absolute end-2 top-1/2 size-3.5 -translate-y-1/2 text-fd-muted-foreground [&_svg]:size-full",
      option: "bg-[Canvas] [color:CanvasText]",
    },
    sliceEditor: {
      "slice-editor":
        "flex flex-1 flex-col rounded-md has-[.cm-content:focus-visible]:outline-2 has-[.cm-content:focus-visible]:outline-offset-2 has-[.cm-content:focus-visible]:outline-fd-ring",
      "slice-scroll":
        "flex-1 rounded-md [&_.cm-content]:min-w-0 [&_.cm-content]:px-3 [&_.cm-content]:py-3 [&_.cm-editor]:min-h-full [&_.cm-gutters]:border-fd-border [&_.cm-gutters]:bg-transparent",
    },
    notePane: {
      "annotation-toggle": cn(
        buttonVariants({ variant: "ghost", size: "icon-2xs" }),
        "aria-pressed:bg-fd-muted",
      ),
      "annotation-edit": buttonVariants({ variant: "ghost", size: "icon-2xs" }),
      // At least five source lines; the tab scrolls when it needs more room.
      "note-pane":
        "flex min-h-30 flex-1 flex-col rounded-md border border-fd-border bg-fd-card [&_.zt-managed]:bg-fd-muted/60 [&_.zt-managed]:shadow-[inset_2px_0_0_0_var(--color-fd-border)]",
      "annotation-box":
        "inline-flex max-w-full items-center gap-1 rounded-md border border-fd-border bg-fd-card p-0.5 ps-2 align-middle text-xs font-medium text-fd-muted-foreground",
      "annotation-label": "min-w-0 whitespace-normal",
      "annotation-actions": "inline-flex shrink-0 items-center",
      "annotation-preview":
        "border-y border-fd-border px-2 pb-2 font-sans whitespace-normal [&_[role=document]>:first-child]:mt-0 [&_[role=document]>:last-child]:mb-0",
      "annotation-selector":
        "-mx-2 mb-2 min-w-0 border-b border-fd-border bg-fd-muted/40 px-2 py-1 [&>div]:mb-0",
      "annotation-problem":
        "mb-2 border-s-2 border-fd-primary bg-fd-accent/40 px-3 py-2 text-sm",
      pending: "text-sm text-fd-muted-foreground",
      "managed-label":
        "rounded-sm border border-fd-border bg-fd-card px-2 py-1 text-xs font-medium text-fd-muted-foreground",
      "managed-line": "zt-managed",
    },
    previewControls: {
      paused: "text-xs text-fd-muted-foreground",
      controls: "mb-2 flex flex-wrap items-center gap-2",
      label: "flex min-w-0 items-center text-xs",
      "label-text": "sr-only",
      run: buttonVariants({ variant: "outline", size: "xs" }),
      stop: buttonVariants({ variant: "ghost", size: "xs" }),
    },
    resultHeader: {
      header:
        "mb-2 flex min-h-8 shrink-0 flex-wrap items-center justify-between gap-2 min-[1180px]:flex-nowrap",
      heading: "shrink-0 text-xs font-semibold",
      controls:
        "flex min-w-0 flex-wrap items-center gap-1.5 min-[1180px]:flex-1 min-[1180px]:flex-nowrap",
      label: "flex min-w-0 items-center text-xs min-[1180px]:flex-1",
      "label-text": "sr-only",
    },
    resultRegion: {
      region:
        // The scroll padding keeps a focused control clear of the sticky file
        // name at the top of the region.
        "group flex min-h-0 flex-1 scroll-pt-10 flex-col overflow-auto rounded-md border border-fd-border bg-fd-card p-4",
    },
    resultColumn: {
      stale: "mb-2 text-xs font-medium",
      behind:
        "mb-2 flex flex-wrap items-center justify-between gap-2 border-s-2 border-fd-primary bg-fd-accent/40 px-3 py-2 text-xs leading-normal",
      "behind-text": "text-pretty",
      run: buttonVariants({ variant: "outline", size: "xs" }),
      // The file name stays at the top of the region while the note scrolls
      // under it: the muted tint lies over the card colour, so nothing shows
      // through.
      filename:
        "sticky -top-4 z-10 -mx-4 -mt-4 mb-4 rounded-t-md border-b border-fd-border bg-fd-card bg-linear-to-b from-fd-muted/40 to-fd-muted/40 px-3 py-1.5 text-xs font-medium",
      "filename-text": "truncate",
      problem:
        "mb-2 border-s-2 border-fd-primary bg-fd-accent/40 px-3 py-2 text-xs leading-normal text-pretty",
      "problem-heading": "font-semibold",
      "problem-output": "mt-1 text-fd-muted-foreground",
      "problem-open": "cursor-pointer underline underline-offset-2",
      empty: "text-sm text-fd-muted-foreground",
      pending: "text-sm text-fd-muted-foreground",
      label: "flex min-w-0 items-center text-xs min-[1180px]:flex-1",
      "label-text": "sr-only",
    },
    propertyList: {
      note: cn(propertyGrid, "mb-4 border-b border-fd-border pb-3"),
      spread: propertyGrid,
      list: propertyGrid,
      row: "flex min-w-0 items-start @max-[250px]:flex-wrap",
      key: "flex w-32 min-w-0 shrink-0 items-start gap-1 py-0.5 text-fd-muted-foreground @max-[250px]:w-full",
      icon: "flex h-[1lh] shrink-0 items-center [&_svg]:size-3.5",
      label: "min-w-0 break-words",
      value:
        "flex min-w-0 flex-1 flex-wrap items-center gap-x-2 py-0.5 ps-2 break-words in-data-[state=number]:tabular-nums @max-[250px]:ps-[1.125rem]",
      pills: "flex min-w-0 flex-wrap gap-x-2 gap-y-0.5",
      pill: "min-w-0 in-data-[state=tags]:text-fd-primary",
      "pill-text": "min-w-0",
      text: "min-w-0",
      checkbox: "m-0 size-3.5 accent-fd-primary",
      empty: "text-fd-muted-foreground italic",
    },
    // The one row above the panels that names the item they all read: its
    // name and badge first, then its controls at the trailing end.
    itemRow: {
      row: "flex min-w-0 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-fd-border px-3 py-1.5",
      label: "min-w-0 flex-1 text-xs text-pretty text-fd-muted-foreground",
    },
    // The side panels: the model places them, so the classes only draw each
    // placement. Each handle is the 12 px gap between two parts
    // (PANEL_HANDLE_WIDTH, which the placement counts), with a rule
    // down its middle that turns the primary color while it is used.
    panels: {
      panels: "flex min-h-0 min-w-0 flex-1",
      stack: "flex min-h-0 min-w-0 flex-1 data-[state=below]:flex-col",
      status: "sr-only",
      editor: "flex min-h-0 min-w-0 flex-1 flex-col",
      panel:
        "flex min-h-0 min-w-0 shrink-0 flex-col data-[state=fields]:w-(--workbench-panel-width) data-[state=preview]:w-(--workbench-panel-width) data-[state=below]:h-(--workbench-panel-height)",
      edge: "relative w-3 shrink-0 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:start-1/2 after:w-px after:bg-fd-muted-foreground hover:after:w-0.5 hover:after:bg-fd-primary focus-visible:after:w-0.5 focus-visible:after:bg-fd-primary",
      split:
        "relative h-3 shrink-0 cursor-row-resize touch-none outline-none after:absolute after:inset-x-0 after:top-1/2 after:h-px after:bg-fd-muted-foreground hover:after:h-0.5 hover:after:bg-fd-primary focus-visible:after:h-0.5 focus-visible:after:bg-fd-primary",
    },
    // The Fields Panel in the Fields popover, which stands inset at the right
    // edge of the panels as tall as they are: it slides in from that edge,
    // and a still motion setting shows it at once. Docked, it is a card in
    // its column, as the Preview is.
    fieldsPanel: {
      panel: cn(
        "flex h-full min-w-0 flex-col rounded-lg border border-fd-border bg-fd-card text-fd-card-foreground",
        "data-[state=popover]:w-80 data-[state=popover]:max-w-full data-[state=popover]:shadow-xl data-[state=popover]:transition-[translate,opacity] data-[state=popover]:duration-150 data-[state=popover]:ease-out motion-reduce:transition-none data-[state=popover]:starting:translate-x-2 data-[state=popover]:starting:opacity-0",
      ),
      header: "flex shrink-0 items-center gap-1 px-2 pt-2",
      icon: "flex shrink-0 ps-1 text-fd-muted-foreground [&_svg]:size-4",
      title: "min-w-0 flex-1 truncate px-1 text-sm font-semibold",
      actions: "contents",
      // With no room to dock, the pin steps back and keeps its focus and
      // its tooltip.
      pin: cn(
        historyButton,
        "shrink-0 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 data-[state=pinned]:bg-fd-accent data-[state=pinned]:text-fd-accent-foreground",
      ),
      close: cn(historyButton, "shrink-0"),
      note: "shrink-0 px-3 pt-0.5 text-xs text-pretty text-fd-muted-foreground",
      body: "flex min-h-0 flex-1 flex-col overflow-auto",
    },
    fieldDetails: {
      /**
       * A fixed height at the panel's foot, so the list above never moves; in
       * a short panel it gives way to the list, which keeps one whole row.
       */
      "details-bar":
        "-mx-2 h-48 max-h-1/2 overflow-y-auto border-t border-fd-border bg-fd-background",
      details:
        "flex flex-col gap-3 p-3 text-xs data-[state=bar]:gap-2 data-[state=bar]:p-2 data-[state=popover]:max-h-(--available-height) data-[state=popover]:overflow-y-auto data-[state=popover]:rounded-lg data-[state=popover]:bg-fd-popover data-[state=popover]:text-fd-popover-foreground data-[state=popover]:shadow-lg data-[state=popover]:ring-1 data-[state=popover]:ring-fd-border",
      header: "flex items-start gap-1",
      heading: "flex min-w-0 flex-1 flex-col",
      context: "truncate text-fd-muted-foreground",
      title: "truncate text-sm font-semibold",
      close: cn(historyButton, "shrink-0"),
      value:
        "in-data-[state=bar]:order-2 max-h-40 overflow-auto rounded-md border border-fd-border p-2 whitespace-pre-wrap [overflow-wrap:anywhere] text-emerald-700 dark:text-emerald-400 data-[state=empty]:text-fd-muted-foreground data-[state=empty]:italic",
      /** A list's values, one per line and numbered. */
      values:
        "in-data-[state=bar]:order-2 flex max-h-40 flex-col gap-1 overflow-auto rounded-md border border-fd-border p-2 text-emerald-700 dark:text-emerald-400",
      "values-item": "flex gap-2 [overflow-wrap:anywhere]",
      "values-index":
        "w-4 shrink-0 text-end tabular-nums text-fd-muted-foreground",
      "values-text":
        "min-w-0 whitespace-pre-wrap data-[state=empty]:text-fd-muted-foreground data-[state=empty]:italic",
      // The bar shows what the note gets right under its heading.
      item: "flex flex-col gap-0.5 in-data-[state=bar]:data-[state=path]:order-3",
      "item-header": "flex flex-wrap items-center gap-x-2 gap-y-1",
      label: "text-fd-muted-foreground",
      forms: "ms-auto flex flex-wrap gap-x-3",
      form: "inline-flex cursor-pointer items-center gap-1 text-fd-muted-foreground has-checked:text-fd-foreground",
      path: "font-mono break-all text-fd-muted-foreground",
      snippet: "font-mono break-all whitespace-pre-wrap text-fd-foreground",
      result:
        "flex gap-1.5 whitespace-pre-line [overflow-wrap:anywhere] text-emerald-700 dark:text-emerald-400 data-[state=empty]:text-fd-muted-foreground data-[state=empty]:italic",
      "result-icon":
        "mt-0.5 flex shrink-0 text-fd-muted-foreground [&_svg]:size-3",
      /** In the bar they stay in view at its foot while the details scroll. */
      actions:
        "flex flex-wrap gap-2 in-data-[state=bar]:order-4 in-data-[state=bar]:sticky in-data-[state=bar]:bottom-0 in-data-[state=bar]:-mx-2 in-data-[state=bar]:bg-fd-background in-data-[state=bar]:px-2 in-data-[state=bar]:py-2",
      insert: buttonVariants({ size: "xs" }),
      copy: buttonVariants({ variant: "outline", size: "xs" }),
      reason: "text-fd-muted-foreground",
    },
    tabBar: {
      "tab-bar": "flex min-w-0 flex-wrap gap-0.5 rounded-md bg-fd-muted p-0.5",
      tab: "disabled:cursor-default disabled:opacity-50 flex min-h-7 min-w-0 cursor-pointer items-center justify-center gap-2 rounded-sm px-2 py-0.5 text-xs font-medium text-fd-muted-foreground data-[state=active]:bg-fd-card data-[state=active]:text-fd-foreground data-[state=active]:shadow-sm [&_svg]:size-4",
    },
    tabPanel: {
      description: "mb-3 shrink-0 text-xs text-pretty text-fd-muted-foreground",
      "tab-panel": "flex min-w-0 flex-1 flex-col [&[hidden]]:hidden",
      "docs-link": "text-fd-primary underline underline-offset-2",
    },
    editToolbar: {
      "edit-toolbar":
        "mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2",
      "mode-group": "flex items-center gap-0.5 rounded-md bg-fd-muted p-0.5",
      mode: cn(
        buttonVariants({ variant: "ghost", size: "2xs" }),
        "rounded-sm text-fd-muted-foreground aria-pressed:bg-fd-card aria-pressed:text-fd-foreground aria-pressed:shadow-sm",
      ),
      "toolbar-actions": "flex items-center gap-1",
      undo: historyButton,
      redo: historyButton,
    },
    problemsFooter: {
      // The reader sizes the open area with its divider.
      problems: cn(
        "relative flex min-h-0 flex-col gap-2 border-t border-t-fd-border px-3 py-2 text-xs leading-normal data-[error]:border-s-2 data-[error]:border-s-destructive",
        "data-[state=compact]:shrink-0 data-[error]:[&_[data-part=problems-text]]:text-destructive",
      ),
      "problems-summary": "flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1",
      "problems-heading": "font-semibold",
      // A value that changes as problems are repaired, so its digits hold
      // their width and it keeps its own line rather than wrapping mid-count.
      "problems-announcement": "sr-only",
      "problems-count":
        "shrink-0 rounded-sm bg-destructive/10 px-1.5 font-medium tabular-nums whitespace-nowrap",
      "problems-text": "min-w-0 text-pretty font-medium",
      // Each control is capped at the row, so a long translated label wraps
      // inside its own box instead of running past the pane.
      "problems-space":
        "ms-auto flex min-w-0 flex-wrap items-center gap-2 [&>*]:max-w-full [&>*]:min-w-0",
      // The full-width divider is visible on hover and keyboard focus.
      "problems-resize":
        "absolute inset-x-0 -top-1 h-2 cursor-row-resize touch-none select-none hover:bg-fd-border focus-visible:bg-fd-primary",
      "problems-error-icon":
        "flex shrink-0 items-center text-destructive [&_svg]:size-4",
      "problems-toggle": cn(
        buttonVariants({ variant: "ghost", size: "icon-xs" }),
      ),
      "problems-body": "flex min-h-0 min-w-0 flex-1 flex-col gap-1",
      // The explanation, and only the explanation, scrolls. It takes whatever
      // the area has left, so the controls keep one place along its bottom
      // edge whichever problem is read and however long its explanation runs.
      // A reader with no pointer scrolls it from the keyboard, so it takes the
      // site's focus indicator the way the other focusable regions do.
      "problems-scroll":
        "flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain pb-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary",
      // The chooser leads the explanation where the object line otherwise
      // would, at its own width rather than stretched across the column.
      "problems-select": "min-w-0 max-w-full self-start",
      "problems-next": "cursor-pointer underline underline-offset-2",
      "problems-object": "font-semibold [overflow-wrap:anywhere]",
      "problems-recovery": "max-w-[75ch] text-pretty leading-normal",
      // A reported location names the engine's own template, which is one
      // unbroken machine-written token in a pane the reader can narrow.
      "problems-location":
        "text-pretty text-fd-muted-foreground [overflow-wrap:anywhere]",
      "problems-details": "mt-2 min-w-0",
      "problems-details-label": "cursor-pointer text-fd-muted-foreground",
      "problems-evidence":
        "mt-1 max-h-40 overflow-auto font-mono whitespace-pre-wrap [overflow-wrap:anywhere]",
      // Its own surface, so the engine's own words read as the block they are.
      // It scrolls in both directions rather than wrapping: a caret excerpt
      // only points at the right column while its lines stay intact.
      "problems-report":
        "mt-1 max-h-56 overflow-auto rounded-md border border-fd-border bg-fd-muted/60 p-2 font-mono whitespace-pre select-text",
      "problems-copy-failed": "mt-1 text-pretty text-destructive",
      // Under the scroll, never inside it: every one of these stays put while
      // a long explanation and an open disclosure move past above them. The
      // rule over them marks where the explanation scrolls out of view, so a
      // line cut at that edge reads as more to scroll, not as covered.
      "problems-controls":
        "flex min-w-0 shrink-0 flex-wrap border-t border-fd-border pt-2 items-center gap-2 [&>*]:max-w-full [&>*]:min-w-0",
      "problems-open": "cursor-pointer underline underline-offset-2",
      "problems-copy": "cursor-pointer underline underline-offset-2",
      "problems-community": "underline underline-offset-2",
    },
  },
  icon(name) {
    const Icon = ICON[name];
    return <Icon aria-hidden />;
  },
};
