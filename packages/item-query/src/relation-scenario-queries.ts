import type { QueryDataset } from "./dataset";
import { ANNOTATIONS } from "./query-annotations";
import { ATTACHMENTS } from "./query-attachments";
import { ITEMS } from "./query-items";
import type { ItemQueryRequest } from "./request";

/** Cross-dataset research questions, also run through the forced scan oracle. */
export const RELATION_SCENARIO_QUERIES: readonly {
  readonly name: string;
  readonly dataset: QueryDataset;
  readonly request: Omit<ItemQueryRequest, "libraries">;
}[] = [
  ...[
    [
      "papers with no usable PDF",
      'attachments.filter(value.contentType == "application/pdf" && value.exists).isEmpty()',
    ],
    [
      "papers in a Collection with no highlight yet",
      'collections.within("Thesis") && annotations.filter(value.type == "highlight").isEmpty()',
    ],
    [
      "papers with more than one PDF",
      'attachments.filter(value.contentType == "application/pdf").length > 1',
    ],
    [
      "papers with marks tagged method",
      'annotations.filter(value.tags.contains("method") && value.dateModified.year == 2024).length > 0',
    ],
    [
      "papers with yellow marks in their files",
      'attachments.filter(value.annotations.filter(value.color == "#ffd400").length > 0).length > 0',
    ],
    ["papers with no file", "!attachments"],
    ["papers with an empty file list", "attachments.isEmpty()"],
    [
      "papers with the first mark on their first file",
      'attachments.filter(index == 0 && value.annotations.filter(index == 0 && value.tags.contains("method")).length > 0).length > 0',
    ],
    [
      "papers with marks reached through a map",
      'attachments.map(value.annotations).flat().filter(value.color == "#ffd400").length > 0',
    ],
    [
      "papers whose marks reach their parent",
      'annotations.filter(value.attachment.title == "Full Text PDF" && value.item.title == title).length > 0',
    ],
    [
      "one paper with a usable PDF",
      'key == "ART2FULL" && attachments.filter(value.exists).length > 0',
    ],
    [
      "papers with any mark",
      '!annotations.filter(value.type == "highlight").isEmpty()',
    ],
  ].map(([name, filter]) => ({
    name: name!,
    dataset: ITEMS,
    request: {
      filter: filter!,
      fields: [
        "title",
        "attachments[].path",
        "annotations[].text",
        "attachments[].annotations[].text",
        "annotations.length",
      ],
      limit: 2,
    },
  })),
  {
    name: "file summaries",
    dataset: ITEMS,
    request: {
      fields: [
        "attachments",
        "attachments[0].item",
        "annotations",
        "annotations[].attachment.tags",
      ],
    },
  },
  {
    name: "marks on each file",
    dataset: ATTACHMENTS,
    request: {
      filter: 'annotations.filter(value.color == "#ffd400").length > 0',
      fields: ["annotations", "annotations.length", "item"],
      limit: 2,
    },
  },
  {
    name: "a mark's sibling files and marks",
    dataset: ANNOTATIONS,
    request: {
      filter:
        'item.attachments.filter(value.contentType == "application/pdf").length > 1 && attachment.annotations.length > 0',
      fields: [
        "item",
        "attachment",
        "item.attachments[].path",
        "attachment.annotations[].text",
      ],
      limit: 2,
    },
  },
];
