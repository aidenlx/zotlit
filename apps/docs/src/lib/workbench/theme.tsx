import { EditorView } from "@codemirror/view";
import {
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
  ChevronRight,
  Ellipsis,
  TextAlignStart,
  Tags,
  Forward,
  Binary,
  SquareCheck,
  Calendar,
  Clock,
} from "lucide-react";
// The web's look for the Workbench UI: the site's Tailwind classes for each
// part of the shared tree, and Lucide for its icons. The tree carries no class
// of its own (ADR 0044); the control sizes are the kit's Workbench variants.

import type { WorkbenchIcon, WorkbenchTheme } from "@zotlit/workbench/ui";

import { buttonVariants } from "@/components/ui/button";
import { inputVariants } from "@/components/ui/input";
import { cn } from "@/lib/cn";

import { editorTheme } from "./editor-theme";

const ICON: Record<WorkbenchIcon, typeof List> = {
  "chevron-right": ChevronRight,
  more: Ellipsis,
  copy: Copy,
  confirm: Check,
  add: Plus,
  remove: Trash2,
  close: X,
  "move-up": ArrowUp,
  "move-down": ArrowDown,
  "choose-sample": Search,
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
};

/** A read-only Properties block: one row per property, key beside value. */
const propertyGrid = "@container flex min-w-0 flex-col gap-y-0.5 text-xs";

const historyButton = buttonVariants({ variant: "ghost", size: "icon-sm" });

const nameInput = inputVariants({ size: "xs" });

export const WEB_THEME: WorkbenchTheme = {
  editorExtension: (slice, language) => [
    editorTheme,
    ...(slice === "filename" ||
    language === "expression" ||
    language === "json-e"
      ? [EditorView.theme({ ".cm-content": { minHeight: "5rem" } })]
      : []),
  ],
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
        "flex min-w-0 flex-1 flex-col gap-2 rounded-md border border-fd-border p-2 data-[state=root]:border-0 data-[state=root]:p-0 [&>[data-part=actions]:first-child]:justify-between",
      rows: "flex flex-col gap-2 list-none m-0 p-0",
      row: "grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-2 [&>[data-part=group]]:col-span-2",
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
      search: "w-full",
      body: "min-h-0 flex-1 overflow-auto",
      empty: "text-fd-muted-foreground text-xs",
    },
    explorerTree: {
      sections: "flex flex-col gap-2",
      section: "",
      "section-header":
        "flex w-full cursor-pointer items-center gap-1 rounded px-1 py-1 text-start text-xs font-semibold text-fd-muted-foreground hover:bg-fd-muted hover:text-fd-foreground aria-disabled:cursor-default",
      "section-chevron":
        "flex size-3 shrink-0 items-center justify-center transition-transform duration-100 ease-out data-[expanded]:rotate-90",
      "section-label": "min-w-0 flex-1",
      "section-count": "font-normal tabular-nums text-fd-muted-foreground",
      tree: "text-xs leading-relaxed",
      spacer: "mt-[3px] size-3 shrink-0",
      /** Key and value share one line while both fit; a longer value drops to its own line beneath the key. */
      contents:
        "flex min-w-0 flex-1 flex-wrap gap-x-1.5 select-text [overflow-wrap:anywhere]",
      group: "ms-3 border-s border-fd-border ps-2",
      chevron:
        "mt-[3px] flex size-3 shrink-0 cursor-pointer items-center justify-center text-fd-muted-foreground transition-transform duration-100 ease-out hover:text-fd-foreground data-[expanded]:rotate-90",
      "chevron-icon": "size-3 [&_svg]:size-3",
      actions:
        "absolute top-0.5 end-0 flex items-center gap-0.5 bg-linear-to-l from-fd-background from-60% to-transparent ps-6 opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100",
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
      row: "group rounded relative flex min-w-0 items-start gap-x-1 px-0.5 hover:bg-fd-muted data-[state=matched]:bg-fd-accent",
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
      "binding-row":
        "flex flex-col gap-2 rounded-md border border-fd-border bg-fd-card px-2.5 py-2",
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
      label: "text-xs font-medium",
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
        "flex min-h-28 flex-col rounded-md border border-fd-border bg-fd-background",
      diagnostics:
        "flex flex-col gap-1 border-s-2 border-fd-foreground ps-3 text-xs leading-normal",
      summary:
        "col-span-2 col-start-1 row-start-2 block min-w-0 text-xs leading-normal break-words text-fd-muted-foreground data-[state=closed]:line-clamp-2",
      "row-action": buttonVariants({ variant: "ghost", size: "icon-xs" }),
      "primary-action": buttonVariants({ variant: "outline", size: "xs" }),
      "secondary-action": buttonVariants({ variant: "ghost", size: "xs" }),
    },
    annotation: {
      "sample-bar": "mb-2 flex shrink-0 items-center gap-2",
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
        "flex min-h-0 flex-1 flex-col rounded-md has-[.cm-content:focus-visible]:outline-2 has-[.cm-content:focus-visible]:outline-offset-2 has-[.cm-content:focus-visible]:outline-fd-ring",
      "slice-scroll":
        "min-h-0 flex-1 overflow-auto rounded-md [&_.cm-content]:min-w-0 [&_.cm-content]:px-3 [&_.cm-content]:py-3 [&_.cm-editor]:min-h-full [&_.cm-gutters]:border-fd-border [&_.cm-gutters]:bg-transparent",
    },
    notePane: {
      "annotation-toggle": cn(
        buttonVariants({ variant: "ghost", size: "icon-2xs" }),
        "aria-pressed:bg-fd-muted",
      ),
      "annotation-edit": buttonVariants({ variant: "ghost", size: "icon-2xs" }),
      "note-pane":
        "flex min-h-0 flex-1 flex-col rounded-md border border-fd-border bg-fd-card [&_.zt-managed]:bg-fd-muted/60 [&_.zt-managed]:shadow-[inset_2px_0_0_0_var(--color-fd-border)]",
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
        "group flex min-h-0 flex-1 flex-col overflow-auto rounded-md border border-fd-border bg-fd-card p-4",
    },
    resultColumn: {
      stale: "mb-2 text-xs font-medium",
      behind:
        "mb-2 flex flex-wrap items-center justify-between gap-2 border-s-2 border-fd-primary bg-fd-accent/40 px-3 py-2 text-xs leading-normal",
      "behind-text": "text-pretty",
      run: buttonVariants({ variant: "outline", size: "xs" }),
      filename:
        "-mx-4 -mt-4 mb-4 rounded-t-md border-b border-fd-border bg-fd-muted/40 px-3 py-1.5 text-xs font-medium",
      "filename-text": "truncate",
      problem:
        "mb-2 border-s-2 border-fd-primary bg-fd-accent/40 px-3 py-2 text-xs leading-normal text-pretty",
      "problem-heading": "font-semibold",
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
    tabBar: {
      "tab-bar": "flex min-w-0 flex-wrap gap-0.5 rounded-md bg-fd-muted p-0.5",
      tab: "disabled:cursor-default disabled:opacity-50 flex min-h-7 min-w-0 cursor-pointer items-center justify-center gap-2 rounded-sm px-2 py-0.5 text-xs font-medium text-fd-muted-foreground data-[state=active]:bg-fd-card data-[state=active]:text-fd-foreground data-[state=active]:shadow-sm [&_svg]:size-4",
    },
    tabPanel: {
      description: "mb-3 shrink-0 text-xs text-pretty text-fd-muted-foreground",
      "tab-panel": "flex min-h-0 min-w-0 flex-1 flex-col [&[hidden]]:hidden",
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
      problems:
        "flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1 border-s-2 border-t border-s-fd-primary border-t-fd-border bg-fd-accent/40 px-3 py-2 text-xs leading-normal",
      "problems-heading": "font-semibold",
      "problems-text": "min-w-0 text-pretty",
      "problems-recovery": "text-fd-muted-foreground",
      "problems-open": "cursor-pointer underline underline-offset-2",
    },
  },
  icon(name) {
    const Icon = ICON[name];
    return <Icon aria-hidden />;
  },
};
