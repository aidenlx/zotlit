// A note's Properties as the Template Workbench draws them: the real
// `PropertyList` of @zotlit/workbench/ui, fed the renderer's own properties.
// Its classes and icons repeat the `propertyList` part of the site's
// Workbench theme (src/lib/workbench/theme.tsx); that theme carries
// CodeMirror, which the landing leaves out.

import {
  Binary,
  Calendar,
  Clock,
  Forward,
  List,
  SquareCheck,
  Tags,
  TextAlignStart,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  PropertyList,
  WorkbenchMessagesProvider,
  WorkbenchThemeProvider,
} from "@zotlit/workbench/ui";
import type { WorkbenchTheme } from "@zotlit/workbench/ui";

import { cn } from "@/lib/cn";
import { m } from "@/paraglide/messages.js";

import { RENDERED_NOTE } from "./rendered-note";

const ICONS: Record<string, LucideIcon> = {
  "property-text": TextAlignStart,
  "property-list": List,
  "property-tags": Tags,
  "property-aliases": Forward,
  "property-number": Binary,
  "property-checkbox": SquareCheck,
  "property-date": Calendar,
  "property-datetime": Clock,
};

const grid = "@container flex min-w-0 flex-col gap-y-0.5 text-xs";

const THEME: WorkbenchTheme = {
  classes: {
    propertyList: {
      note: cn(grid, "mb-4 border-b border-fd-border pb-3"),
      spread: grid,
      list: grid,
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
  },
  icon: (name) => {
    const Icon = ICONS[name];
    return Icon ? <Icon aria-hidden strokeWidth={1.5} /> : null;
  },
};

export function NoteProperties() {
  return (
    <WorkbenchMessagesProvider messages={m}>
      <WorkbenchThemeProvider theme={THEME}>
        <PropertyList
          properties={RENDERED_NOTE.properties}
          label={m.workbench_result_properties()}
          variant="note"
        />
      </WorkbenchThemeProvider>
    </WorkbenchMessagesProvider>
  );
}
