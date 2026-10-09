// The CLI Datasets: one for each Query Dataset of the engine. A CLI Dataset
// holds everything that differs between the Item Query and the Annotation
// Query commands, so the registration, the service and the worker answer look
// it up and branch on nothing else.
//
// Command, flag, and diagnostic text is all hardcoded English: an
// agent-facing contract surface, not localized UI. See
// apps/obsidian/policies/cli-text.md.

import type { CliData, CliFlag, CliFlags } from "obsidian";

import { ANNOTATIONS, ITEMS } from "@zotlit/item-query";
import type { AnnotationQueryRequest, QueryDataset } from "@zotlit/item-query";

import type { CliRequest } from "@/lib/cli-params";

import {
  ANNOTATION_GUIDE_TOPIC_NAMES,
  renderAnnotationGuide,
} from "./annotation-guide";
import {
  ANNOTATION_QUERY_COMMAND,
  ANNOTATION_QUERY_GUIDE_COMMAND,
  ANNOTATION_QUERY_SCHEMA_COMMAND,
  annotationQueryFlags,
  ITEM_QUERY_COMMAND,
  ITEM_QUERY_GUIDE_COMMAND,
  ITEM_QUERY_SCHEMA_COMMAND,
  itemQueryFlags,
} from "./contract";
import type { ItemQueryCommand } from "./contract";
import {
  decodeAnnotationGuideArguments,
  decodeAnnotationQuery,
  decodeGuideArguments,
  decodeItemQuery,
} from "./decode";
import type { DecodedQuery } from "./decode";
import { GUIDE_TOPIC_NAMES, renderGuide } from "./guide";
import type { QueryDatasetId } from "./worker-protocol";

/** One CLI command of a dataset: its name and its help line. */
interface CliCommand {
  readonly name: ItemQueryCommand;
  readonly description: string;
}

/** The Item Query or the Annotation Query commands. */
export interface CliDataset {
  readonly id: QueryDatasetId;
  /**
   * The engine descriptor. Typed with the widest request: an Item Query
   * request carries no Annotation selectors.
   */
  readonly engine: QueryDataset<AnnotationQueryRequest>;
  readonly query: CliCommand;
  readonly schema: CliCommand;
  readonly guide: CliCommand;
  /** The flags of the query command. */
  readonly flags: CliFlags;
  /** The flags of the guide command. */
  readonly guideFlags: CliFlags;
  /** Decode the flat arguments of the query command. */
  readonly decode: (params: CliData) => CliRequest<DecodedQuery>;
  /** The text of the guide topic that the flat arguments name. */
  readonly renderGuide: (params: CliData) => CliRequest<string>;
  /** The name of the version-pinned schema asset of the Resource Release. */
  readonly schemaAsset: string;
}

const topicFlag = (names: readonly string[]): CliFlags =>
  ({
    topic: {
      value: `<${names.join("|")}>`,
      description: "Guide topic; omit it for the quickstart",
    },
  }) satisfies Record<"topic", CliFlag>;

function rendered<T>(
  request: CliRequest<T>,
  render: (value: T) => string,
): CliRequest<string> {
  return request.kind === "invalid"
    ? request
    : { kind: "valid", value: render(request.value) };
}

const ITEM_QUERY: CliDataset = {
  id: "items",
  engine: ITEMS,
  query: {
    name: ITEM_QUERY_COMMAND,
    description:
      "Query Zotero Items as JSON; read zotlit:item-query-guide for syntax and zotlit:item-query-schema for the published field catalog",
  },
  schema: {
    name: ITEM_QUERY_SCHEMA_COMMAND,
    description:
      "Get the version-pinned schema download, source custom fields, and CLI defaults as JSON",
  },
  guide: {
    name: ITEM_QUERY_GUIDE_COMMAND,
    description: "Print the ZotLit Item Query guide",
  },
  flags: itemQueryFlags,
  guideFlags: topicFlag(GUIDE_TOPIC_NAMES),
  decode: decodeItemQuery,
  renderGuide: (params) => rendered(decodeGuideArguments(params), renderGuide),
  schemaAsset: "item-query",
};

const ANNOTATION_QUERY: CliDataset = {
  id: "annotations",
  engine: ANNOTATIONS,
  query: {
    name: ANNOTATION_QUERY_COMMAND,
    description:
      "Query Zotero Annotations as JSON; read zotlit:annotation-query-guide for syntax and zotlit:annotation-query-schema for the published field catalog",
  },
  schema: {
    name: ANNOTATION_QUERY_SCHEMA_COMMAND,
    description:
      "Get the Annotation Query schema download, source custom fields, and CLI defaults as JSON",
  },
  guide: {
    name: ANNOTATION_QUERY_GUIDE_COMMAND,
    description: "Print the ZotLit Annotation Query guide",
  },
  flags: annotationQueryFlags,
  guideFlags: topicFlag(ANNOTATION_GUIDE_TOPIC_NAMES),
  decode: decodeAnnotationQuery,
  renderGuide: (params) =>
    rendered(decodeAnnotationGuideArguments(params), renderAnnotationGuide),
  schemaAsset: "annotation-query",
};

/** The CLI dataset of each Query Dataset, in registration order. */
export const CLI_DATASETS: Readonly<Record<QueryDatasetId, CliDataset>> = {
  items: ITEM_QUERY,
  annotations: ANNOTATION_QUERY,
};
