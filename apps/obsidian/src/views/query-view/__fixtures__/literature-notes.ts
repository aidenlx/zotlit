import type { LiteratureNotes } from "@/views/query-view/table-notes";

/** A vault with no Literature Note: no note to link, and no vault property. */
export function noLiteratureNotes(): LiteratureNotes {
  return {
    find: () => null,
    on: () => () => {},
    propertyNames: () => [],
    itemKeys: () => [],
    propertyType: () => "text",
    read: () => ({ note: false }),
    open: () => {},
    create: () => Promise.resolve(),
  };
}
