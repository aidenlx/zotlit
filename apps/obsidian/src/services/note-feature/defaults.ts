import { type FrontmatterField } from "@zotlit/templates/frontmatter";

export const DEFAULT_NOTE_FILENAME =
  "<%= zt.citationKey ?? zt.DOI ?? zt.title ?? zt.key %><%= suffix() %>";

export const DEFAULT_FRONTMATTER_FIELDS = Object.freeze([
  Object.freeze({ key: "title", expr: "zt.title", merge: "replace" }),
  Object.freeze({
    key: "related",
    expr: "zt.relatedItems.map((item) => item.noteLink()).filter(Boolean)",
    merge: "replace",
  }),
  Object.freeze({
    key: "collections",
    expr: "zt.collections.map((c) => c.name)",
    merge: "replace",
  }),
]) satisfies readonly FrontmatterField[];
