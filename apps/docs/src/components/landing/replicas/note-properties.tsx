// A note's Properties as the Template Workbench draws them, fed the
// renderer's own properties (rendered-note.ts). A replica of `PropertyList`
// (packages/workbench/src/ui/property-list.tsx) with the classes and icons of
// the site's Workbench theme (src/lib/workbench/theme.tsx): importing the
// component from `@zotlit/workbench/ui` brings the Workbench's editor bundle,
// CodeMirror included, onto the landing's first load.

import { List, TextAlignStart } from "lucide-react";

import { m } from "@/paraglide/messages.js";

import { RENDERED_NOTE } from "./rendered-note";

export function NoteProperties() {
  return (
    <dl
      aria-label={m.workbench_result_properties()}
      className="@container mb-4 flex min-w-0 flex-col gap-y-0.5 border-b border-fd-border pb-3 text-xs"
    >
      {RENDERED_NOTE.properties.map((property) => {
        const list = Array.isArray(property.value);
        const values = list ? (property.value as string[]) : [];
        const Icon = list ? List : TextAlignStart;
        return (
          <div
            key={property.key}
            className="flex min-w-0 items-start @max-[250px]:flex-wrap"
          >
            <dt className="flex w-32 min-w-0 shrink-0 items-start gap-1 py-0.5 text-fd-muted-foreground @max-[250px]:w-full">
              <span aria-hidden className="flex h-[1lh] shrink-0 items-center">
                <Icon className="size-3.5" strokeWidth={1.5} />
              </span>
              <span className="min-w-0 break-words">{property.key}</span>
            </dt>
            <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 py-0.5 ps-2 break-words">
              {list && values.length === 0 ? (
                <span className="text-fd-muted-foreground italic">
                  {m.workbench_property_empty()}
                </span>
              ) : list ? (
                values.map((v) => (
                  <span key={v} className="min-w-0">
                    {v}
                  </span>
                ))
              ) : (
                <span className="min-w-0">{String(property.value)}</span>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
