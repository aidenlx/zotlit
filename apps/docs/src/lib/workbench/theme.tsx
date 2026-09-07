import { EditorView } from "@codemirror/view";
import {
  Code2,
  Eye,
  Pencil,
  List,
  Redo2,
  Undo2,
  ChevronDown,
} from "lucide-react";
// The web's look for the Workbench UI: the site's Tailwind classes for each
// part of the shared tree, and Lucide for its icons. The tree carries no class
// of its own (ADR 0044); the control sizes are the kit's Workbench variants.

import type { WorkbenchIcon, WorkbenchTheme } from "@zotlit/workbench/ui";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";

import { editorTheme } from "./editor-theme";

const ICON: Record<WorkbenchIcon, typeof List> = {
  "chevron-down": ChevronDown,
  preview: Eye,
  edit: Pencil,
  basic: List,
  advanced: Code2,
  undo: Undo2,
  redo: Redo2,
};

const historyButton = buttonVariants({ variant: "ghost", size: "icon-sm" });

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
      note: "grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-3 gap-y-1 mb-4 border-b border-fd-border pb-3 text-xs",
      spread:
        "grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs",
      fold: "grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-3 gap-y-1 mt-2 text-xs",
      key: "truncate font-mono text-fd-muted-foreground",
      value: "break-words",
      empty: "text-fd-muted-foreground italic",
      list: "grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-3 gap-y-1",
    },
    tabBar: {
      "tab-bar": "flex min-w-0 flex-wrap gap-0.5 rounded-md bg-fd-muted p-0.5",
      tab: "flex min-h-7 min-w-0 cursor-pointer items-center justify-center gap-2 rounded-sm px-2 py-0.5 text-xs font-medium text-fd-muted-foreground data-[state=active]:bg-fd-card data-[state=active]:text-fd-foreground data-[state=active]:shadow-sm [&_svg]:size-4",
    },
    tabPanel: {
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
