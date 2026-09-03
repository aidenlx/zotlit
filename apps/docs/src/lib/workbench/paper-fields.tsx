// The field list column: this paper's own values, beside the names a template
// reads them by.

import type { SAMPLE_ITEMS } from "@zotlit/workbench/render";

import { m } from "@/paraglide/messages.js";

export type SampleItem = (typeof SAMPLE_ITEMS)[number];

/** The paper's own values, so the reader recognizes them before the field names. */
export function PaperFields({ snapshot }: { snapshot: SampleItem }) {
  const fields = Object.entries(snapshot.roots.note).filter(
    ([, value]) =>
      (typeof value === "string" && value !== "") || typeof value === "number",
  );

  return (
    <section className="flex min-h-0 flex-col">
      <h2 className="font-serif text-[1.06rem] font-medium">
        {m.workbench_fields_heading()}
      </h2>
      <p className="mt-1 mb-2.5 text-xs text-fd-muted-foreground">
        {m.workbench_fields_lede()}
      </p>
      <ul className="min-h-0 flex-1 overflow-auto border border-fd-border bg-fd-card">
        {fields.map(([key, value]) => (
          <li
            key={key}
            className="border-b border-fd-border/60 px-3 py-1.5 last:border-b-0"
          >
            <p className="font-mono text-[0.7rem] text-fd-primary">{`zt.${key}`}</p>
            <p className="truncate text-xs text-fd-muted-foreground">
              {String(value)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
