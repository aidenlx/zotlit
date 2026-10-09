import type { ItemQueryRequest } from "./request";
/** Every Attachment scenario is checked against the forced scan. */
export const ATTACHMENT_SCENARIO_QUERIES: readonly Omit<
  ItemQueryRequest,
  "libraries"
>[] = [
  {},
  { fields: [], limit: 2 },
  { fields: ["item.creators[].fullName", "tags[]", "item", "item.indexedKey"] },
  ...[
    'key == "PDF2LINK"',
    'indexedKey == "PDF2LINK"',
    'tags.contains("attachment-method")',
    'tags.contains("missing")',
    'contentType == "application/pdf"',
    'linkMode == "linked_file" && !exists',
    'linkMode == "linked_url"',
    'item.collections.contains("Thesis/Methods")',
    'item.collections.within("Thesis")',
    'item.key == "ART2FULL"',
    'item.custom["review.status"] == "done"',
    'item.creators.contains("Ada Lovelace")',
    'library == "group:4815"',
    'library != "personal"',
    "dateModified.year == 2024",
    "url == null",
    'title.contains("PDF")',
    'contentType == "application/pdf" || tags.contains("missing")',
    '!(linkMode == "linked_file")',
    'key == "PDF2LIVE" && item.tags.contains("methods")',
  ].map((filter) => ({
    filter,
    fields: [
      "key",
      "library",
      "title",
      "linkMode",
      "path",
      "exists",
      "url",
      "tags",
      "item.title",
      'item.custom["review.status"]',
    ],
  })),
  ...[
    "dateAdded",
    "dateModified",
    "title",
    "contentType",
    "linkMode",
    "item.title",
    "item.date",
    "item.dateModified",
  ].flatMap((field) =>
    (["asc", "desc"] as const).map((direction) => ({
      sort: [{ field, direction }],
      limit: 3,
    })),
  ),
];
