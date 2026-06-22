export const DEFAULT_NOTE_FILENAME =
  "<%= zt.citationKey ?? zt.DOI ?? zt.title ?? zt.key %>";

export const DEFAULT_FRONTMATTER_FIELDS: ReadonlyArray<{
  readonly key: string;
  readonly expr: string;
}> = Object.freeze([
  Object.freeze({ key: "title", expr: "zt.title" }),
  Object.freeze({
    key: "related",
    expr: "zt.relatedItems.map((item) => item.noteLink()).filter(Boolean)",
  }),
]);
