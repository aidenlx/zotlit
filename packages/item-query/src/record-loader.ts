// Record Loader: one load plan and one bounded traversal for every Query Dataset.
import { Effect } from "effect";

import type {
  ItemQueryDatabase,
  ItemQueryReaderError,
  ScanRow,
} from "@zotlit/db/item-query";

import type { ItemQueryError } from "./error";
import type { FilterPlan } from "./filter-plan";
import type { QuerySources } from "./query-sources";
import { loadRelation, relationChunk } from "./relation-hydration";
import type { RelationChunk } from "./relation-hydration";
import type { ItemQueryPlan, TargetLibrary } from "./request";

export type Read<A> = Effect.Effect<A, ItemQueryReaderError, ItemQueryDatabase>;

/** A pass gives records in chunk order and owns no records between chunks. */
export interface Loader<Row extends ScanRow, Value> {
  /** A pass that hydrates uses the hydrate chunk bound instead of the scan page bound. */
  readonly hydrates: boolean;
  readonly load: (
    chunk: readonly Row[],
    libraryAt: (index: number) => TargetLibrary,
    relations?: RelationChunk,
  ) => Read<readonly Value[]>;
}

export type LoadRequest<Needs> = Pick<ItemQueryPlan, "dataset" | "query"> & {
  readonly group?: {
    readonly text: string;
    readonly customField: string | null;
  } | null;
  readonly groupNeeds: readonly Needs[];
  readonly filter: {
    readonly needs: readonly Needs[];
    readonly customFields: FilterPlan["customFields"];
  } | null;
  readonly paths: readonly {
    readonly text: string;
    readonly needs: Needs;
    readonly customField: string | null;
  }[];
  readonly sorts: readonly { readonly needs: Needs }[];
};

export interface LoadContext {
  readonly sources: QuerySources;
  readonly libraries: readonly TargetLibrary[];
}

/** Own fields, Parent Records, and Relation Lists are facts of a Query Dataset. */
export interface LoadingDescriptor<
  Needs,
  Row extends ScanRow,
  Own,
  Links extends object,
  Value,
> {
  readonly own: (
    needs: readonly Needs[],
    context: LoadContext,
  ) => Read<Loader<Row, Own>>;
  readonly relations: {
    readonly [Name in keyof Links]: RecordRelation<Needs, Row, Links[Name]>;
  };
  readonly record: (
    own: Own,
    context: {
      readonly scan: Row;
      readonly library: TargetLibrary;
      readonly related: Partial<Links>;
    },
  ) => Value;
}

interface RelationLoader<Row extends ScanRow, Value> {
  readonly hydrates: boolean;
  readonly load: (
    chunk: readonly Row[],
    libraryAt: (index: number) => TargetLibrary,
    relations: RelationChunk,
  ) => Read<(index: number) => Value | undefined>;
}

interface RecordRelation<Needs, Row extends ScanRow, Value> {
  readonly open: (
    needs: readonly Needs[],
    context: LoadContext,
  ) => Read<RelationLoader<Row, Value> | null>;
}

/** Flatten filter, sort, Query Group, and projection needs once at the root. */
export const openRecordLoader = Effect.fnUntraced(function* <
  Needs,
  Row extends ScanRow,
  Own,
  Links extends object,
  Value,
>(
  descriptor: LoadingDescriptor<Needs, Row, Own, Links, Value>,
  request: LoadRequest<Needs>,
  context: LoadContext,
): Effect.fn.Return<
  {
    readonly scan: Loader<Row, Value>;
    readonly projection: Loader<Row, Value>;
  },
  ItemQueryError | ItemQueryReaderError,
  ItemQueryDatabase
> {
  yield* context.sources.checkCustomFields(request);
  return {
    scan: yield* openPass(
      descriptor,
      [
        ...(request.filter?.needs ?? []),
        ...request.sorts.map((sort) => sort.needs),
        ...request.groupNeeds,
      ],
      context,
    ),
    projection: yield* openPass(
      descriptor,
      request.paths.map((path) => path.needs),
      context,
    ),
  };
});

const openPass = Effect.fnUntraced(function* <
  Needs,
  Row extends ScanRow,
  Own,
  Links extends object,
  Value,
>(
  descriptor: LoadingDescriptor<Needs, Row, Own, Links, Value>,
  needs: readonly Needs[],
  context: LoadContext,
): Effect.fn.Return<
  Loader<Row, Value>,
  ItemQueryReaderError,
  ItemQueryDatabase
> {
  const own = yield* descriptor.own(needs, context);
  const related = new Map<
    keyof Links,
    RelationLoader<Row, Links[keyof Links]>
  >();
  for (const name of Object.keys(descriptor.relations) as (keyof Links)[]) {
    const loader = yield* descriptor.relations[name].open(needs, context);
    if (loader) related.set(name, loader);
  }
  return {
    hydrates:
      own.hydrates || [...related.values()].some((loader) => loader.hydrates),
    load: Effect.fnUntraced(function* (
      chunk,
      libraryAt,
      relations = relationChunk(),
    ) {
      const values = yield* own.load(chunk, libraryAt, relations);
      const links = new Map<
        keyof Links,
        (index: number) => Links[keyof Links] | undefined
      >();
      for (const [name, loader] of related)
        links.set(name, yield* loader.load(chunk, libraryAt, relations));
      return chunk.map((scan, index) => {
        const related: Partial<Links> = {};
        for (const [name, at] of links) related[name] = at(index);
        return descriptor.record(values[index]!, {
          scan,
          library: libraryAt(index),
          related,
        });
      });
    }),
  };
});

/** A Parent Record is deduplicated by source ID within the current chunk. */
export function parentRecord<
  Needs,
  Row extends ScanRow,
  ParentNeeds,
  ParentRow extends ScanRow,
  Own,
  Links extends object,
  Value,
>(relation: {
  readonly needs: (needs: Needs) => readonly ParentNeeds[] | undefined;
  readonly descriptor: () => LoadingDescriptor<
    ParentNeeds,
    ParentRow,
    Own,
    Links,
    Value
  >;
  readonly row: (row: Row) => ParentRow;
  /** Identity fields need the Parent Record even when its fields need no hydration. */
  readonly required?: boolean;
}): RecordRelation<Needs, Row, Value> {
  return {
    open: Effect.fnUntraced(function* (needs, context) {
      if (
        !relation.required &&
        !needs.some((need) => relation.needs(need) !== undefined)
      )
        return null;
      const parent = yield* openPass(
        relation.descriptor(),
        needs.flatMap((need) => relation.needs(need) ?? []),
        context,
      );
      return {
        hydrates: parent.hydrates,
        load: Effect.fnUntraced(function* (chunk, libraryAt, relations) {
          const rows = [
            ...new Map(
              chunk.map((row, index) => {
                const scan = relation.row(row);
                return [
                  scan.itemID,
                  { scan, library: libraryAt(index) },
                ] as const;
              }),
            ).values(),
          ];
          const values = yield* parent.load(
            rows.map((row) => row.scan),
            (index) => rows[index]!.library,
            relations,
          );
          const byID = new Map(
            rows.map((row, index) => [row.scan.itemID, values[index]!]),
          );
          return (index) => byID.get(relation.row(chunk[index]!).itemID);
        }),
      };
    }),
  };
}

/** Relation Lists reuse their raw rows and loaded records within a root chunk. */
export function relationList<
  Needs,
  Row extends ScanRow,
  ChildNeeds,
  ChildRow extends ScanRow & { libraryID: number },
  Own,
  Links extends object,
  Value,
>(relation: {
  readonly needs: (needs: Needs) => readonly ChildNeeds[] | undefined;
  readonly descriptor: () => LoadingDescriptor<
    ChildNeeds,
    ChildRow,
    Own,
    Links,
    Value
  >;
  readonly read: (
    relations: RelationChunk,
    ids: readonly number[],
  ) => Read<readonly ChildRow[]>;
  readonly parentID: (row: ChildRow) => number;
}): RecordRelation<Needs, Row, readonly Value[]> {
  return {
    open: Effect.fnUntraced(function* (needs, context) {
      if (!needs.some((need) => relation.needs(need) !== undefined))
        return null;
      const child = yield* openPass(
        relation.descriptor(),
        needs.flatMap((need) => relation.needs(need) ?? []),
        context,
      );
      return {
        hydrates: true,
        load: Effect.fnUntraced(function* (chunk, _libraryAt, relations) {
          const rows = yield* relation.read(
            relations,
            chunk.map((row) => row.itemID),
          );
          const values = yield* loadRelation(child, rows, {
            ...context,
            relations,
            parentID: relation.parentID,
          });
          return (index) => values.get(chunk[index]!.itemID) ?? [];
        }),
      };
    }),
  };
}
