import type { LiteratureNotes } from "@/views/query-view/table-notes";

/** A vault with no Literature Note: no note to link, and no vault property. */
export function noLiteratureNotes(): LiteratureNotes {
  return {
    find: () => null,
    on: () => () => {},
    propertyNames: () => [],
    propertyType: () => "text",
    read: () => ({ note: false }),
    managed: () => false,
    write: () => Promise.resolve("no-note"),
    open: () => {},
    create: () => Promise.resolve(),
  };
}
