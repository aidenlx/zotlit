// The Query Dataset descriptor: everything that differs between Item Query and
// Annotation Query. The request planner, the diagnoser, the schema description
// and the operations read a descriptor and branch on nothing else.
import { Context } from "effect";
import type { Effect } from "effect";

import type { Attachment } from "@zotlit/db";
import type {
  ItemQueryDatabase,
  ItemQueryReaderError,
  ScanRow,
} from "@zotlit/db/item-query";

import type { ItemQueryError } from "./error";
import type { DatasetRun } from "./execution";
import type {
  FieldDefinition,
  FieldNeeds,
  FilterField,
  SortKey,
} from "./fields";
import type { FilterPlan, FilterProblem } from "./filter-plan";
import type { PathSegment } from "./projection-path";
import type { QueryClock } from "./query-clock";
import type { ItemQueryPlan, ItemQueryRequest, SortSpec } from "./request";

/** The field part of a dotted name: the text before its first `.` or `[`. */
export function fieldRoot(name: string): string {
  return name.split(".")[0]!.split("[")[0]!;
}

/** What a Sortable Field gives the planner: its hydration needs and its key. */
export interface SortableField<Item, Needs = FieldNeeds> {
  readonly needs: Needs;
  readonly key: (item: Item, clock: QueryClock) => SortKey;
}

/** Resolves the file of an Attachment that an Annotation Query projects. */
export type ResolveAttachmentFile = (attachment: Attachment) => Effect.Effect<{
  readonly path: string | null;
  readonly exists: boolean;
}>;

/**
 * The Attachment file resolver of one run. Without one, an Annotation Query
 * projects each Attachment file as absent.
 */
export const AttachmentFileResolver =
  Context.Reference<ResolveAttachmentFile | null>(
    "@zotlit/item-query/AttachmentFileResolver",
    { defaultValue: () => null },
  );

/**
 * One Query Dataset: Items or Annotations. `Request` is the request the
 * dataset takes. The record type of a row is internal to the descriptor.
 */
export interface QueryDataset<
  Request extends ItemQueryRequest = ItemQueryRequest,
> {
  readonly id: "items" | "annotations";
  /** The record of one row in prose: `Item` or `Annotation`. */
  readonly noun: string;
  /** The query in prose: `Item Query` or `Annotation Query`. */
  readonly family: string;
  /** What a custom field path starts with: `custom[...]` or `item.custom[...]`. */
  readonly customPrefix: string;
  /** The Projection Paths of a request that names no fields. */
  readonly defaultFields: readonly string[];
  /** The sort of a request that names no sort. */
  readonly defaultSort: readonly SortSpec[];
  /**
   * The Sortable Fields that break a tie of the request's sort, before the
   * Indexed Key. The normalized query does not echo them.
   */
  readonly tieBreakers: readonly SortSpec[];
  /** The bare names the diagnoser may list. */
  readonly names: readonly string[];
  /** Every Sortable Field, in the order the diagnoser lists them. */
  readonly sortableFields: readonly string[];
  readonly definition: (name: string) => FieldDefinition<any, any> | undefined;
  /** The meaning of a bare name in a Filter Expression. */
  readonly filterField: (name: string) => FilterField<any, any> | undefined;
  readonly planFilter: (text: string) => FilterPlan<any, any> | FilterProblem;
  /** The Sortable Field of a name, or nothing for a name that does not sort. */
  readonly sortable: (name: string) => SortableField<any, any> | undefined;
  /** The field that the leading segments of a Projection Path name. */
  readonly resolvePath: (segments: readonly PathSegment[]) =>
    | {
        readonly field: FieldDefinition<any, any>;
        readonly rest: readonly PathSegment[];
      }
    | undefined;
  /** The field part of a dotted name, with the parent prefix it names. */
  readonly rootName: (name: string) => string;
  readonly readScanPage: (page: {
    libraryID: number;
    afterKey: string | null;
    size: number;
  }) => Effect.Effect<
    readonly ScanRow[],
    ItemQueryReaderError,
    ItemQueryDatabase
  >;
  readonly readUniverseRows: (chunk: {
    libraryID: number;
    itemIDs: readonly number[];
  }) => Effect.Effect<
    readonly ScanRow[],
    ItemQueryReaderError,
    ItemQueryDatabase
  >;
  /**
   * Open the run of a planned request: hydration, candidate sets, the match
   * and the projection of one record.
   */
  open(
    plan: ItemQueryPlan,
    request: Request,
    clock: QueryClock,
  ): Effect.Effect<
    DatasetRun<any>,
    ItemQueryError | ItemQueryReaderError,
    ItemQueryDatabase
  >;
}
