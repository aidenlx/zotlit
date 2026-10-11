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
  ...[ITEMS, ATTACHMENTS, ANNOTATIONS].map((dataset) => ({
    name: `${dataset.id} key projection and sort`,
    dataset,
    request: {
      fields: ["indexedKey", "key"],
      sort: [{ field: "indexedKey", direction: "desc" as const }],
    },
  })),
  {
    name: "Attachment file types from Annotations",
    dataset: ANNOTATIONS,
    request: {
      filter: 'attachment.fileType == "pdf"',
      fields: ["attachment.fileType"],
      group: "attachment.fileType",
    },
  },
  ...(
    [
      [ITEMS, "attachments", 'value.tags.contains("downloaded")'],
      [ITEMS, "attachments", 'value.key == "PDF2LIVE"'],
      [ITEMS, "attachments", 'value.indexedKey == "PDF2LIVE"'],
      [
        ITEMS,
        "attachments",
        '["PDF2LIVE", "PDF2GRUPg314"].contains(value.indexedKey)',
      ],
      [ITEMS, "attachments", 'value.contentType == "application/pdf"'],
      [ITEMS, "attachments", 'value.fileType == "pdf"'],
      [ITEMS, "attachments", 'value.fileType == "epub"'],
      [ITEMS, "attachments", 'value.fileType == "web"'],
      [ITEMS, "attachments", 'value.fileType == "other"'],
      [ITEMS, "attachments", 'value.linkMode == "linked_file"'],
      [ITEMS, "attachments", 'value.item.collections.within("Thesis")'],
      [
        ITEMS,
        "annotations",
        'value.type == "highlight" && value.color == "#ffd400"',
      ],
      [
        ITEMS,
        "annotations",
        'value.tags.contains("method") || value.key == "ANN2NOTE"',
      ],
      [ATTACHMENTS, "annotations", 'value.tags.contains("method")'],
      [ATTACHMENTS, "annotations", 'value.attachment.indexedKey == "PDF2LIVE"'],
      [
        ITEMS,
        "attachments",
        'value.annotations.filter(value.tags.contains("method")).length >= 1',
      ],
    ] as const
  ).flatMap(([dataset, relation, predicate]) =>
    [
      `${relation}.filter(${predicate}).length > 0`,
      `${relation}.filter(${predicate}).length >= 1`,
      `!${relation}.filter(${predicate}).isEmpty()`,
    ].map((filter) => ({
      name: `relation existence: ${filter}`,
      dataset,
      request: { filter, fields: [], limit: 2 },
    })),
  ),
  ...[
    'attachments.filter(value.indexedKey == "PDF2LIVEg118").length > 0',
    'attachments.filter(value.item.indexedKey == "ART2FULLg118").length > 0',
    'annotations.filter(value.color == "yellow").length > 0',
    'attachments.filter(value.annotations.filter(value.color == "yellow").length > 0).length > 0',
    'if(true, attachments, []).filter(value.title == "Full Text PDF").length > 0',
    'if(false, attachments, annotations[0].item.attachments).filter(value.title == "Full Text PDF").length > 0',
    'annotations.filter(value.color == "#ffd400" && value.type == "image").length > 0',
    'annotations.filter(value.tags.contains("method") && index == 0).length > 0',
    'annotations.filter(value.tags.contains("method") || index == 0).length > 0',
    'annotations.filter(key == "ART2FULL" && value.type == "highlight").length > 0',
    'annotations.filter(key == "ART2FULL").length > 0',
    'annotations.filter(value.indexedKey == "ANN2HGHTg314").length > 0',
    'annotations.filter(value.item.collections.contains("Thesis/Methods")).length > 0',
    'annotations.filter(value.item.title == "A complete article").length > 0',
    '!(annotations.filter(value.tags.contains("method")).length > 0)',
    'annotations.filter(value.tags.contains("method")).isEmpty()',
    'annotations.filter(value.tags.contains("method")).length > 1',
    'annotations.filter(value.tags.contains("method")).length >= 2',
    'attachments.filter(value.annotations.filter(value.tags.contains("method")).isEmpty()).length > 0',
    'attachments.filter(value.contentType == "application/pdf" && value.annotations.filter(value.tags.contains("method")).isEmpty()).length > 0',
  ].map((filter) => ({
    name: `relation residual: ${filter}`,
    dataset: ITEMS,
    request: { filter, fields: ["title"], limit: 2 },
  })),
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
