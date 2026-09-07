// The web's look for the Workbench UI: the site's Tailwind classes for each
// part of the shared tree, and Lucide for its icons. The tree carries no class
// of its own (ADR 0044); the control sizes are the kit's Workbench variants.

import { Code2, List, Redo2, Undo2 } from "lucide-react";

import type { WorkbenchIcon, WorkbenchTheme } from "@zotlit/workbench/ui";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";

const ICON: Record<WorkbenchIcon, typeof List> = {
  basic: List,
  advanced: Code2,
  undo: Undo2,
  redo: Redo2,
};

const historyButton = buttonVariants({ variant: "ghost", size: "icon-sm" });

export const WEB_THEME: WorkbenchTheme = {
  classes: {
    previewControls: {
      controls: "mb-2 flex flex-wrap items-center gap-2",
      label: "flex min-w-0 items-center text-xs",
      "label-text": "sr-only",
      select:
        "min-h-8 rounded-md border border-fd-border bg-fd-card px-2 py-1 text-xs",
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
      select:
        "min-h-8 w-full min-w-0 rounded-md border border-fd-border bg-fd-card py-1 ps-2 pe-7 text-xs hover:bg-fd-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring disabled:cursor-default",
    },
    resultRegion: {
      region:
        "group flex min-h-0 flex-1 flex-col overflow-auto rounded-md border border-fd-border bg-fd-card p-4",
    },
    resultColumn: {
      select:
        "min-h-8 w-full min-w-0 rounded-md border border-fd-border bg-fd-card py-1 ps-2 pe-7 text-xs hover:bg-fd-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring disabled:cursor-default",
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
