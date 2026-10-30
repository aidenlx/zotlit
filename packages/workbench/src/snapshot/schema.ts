// The Item Snapshot as data: the one definition of its shape. The types are
// read from these schemas, and a host that stores or receives a snapshot
// validates it with them. Browser-safe.

import * as v from "valibot";

import { queryItemSeedSchema } from "@zotlit/item-query";

const readonlyArray = <TItem extends v.GenericSchema>(item: TItem) =>
  v.pipe(v.array(item), v.readonly());

const templatePathSchema = readonlyArray(v.union([v.string(), v.number()]));

const snapshotStringCoercionSchema = v.pipe(
  v.object({ path: templatePathSchema, value: v.string() }),
  v.readonly(),
);
export type SnapshotStringCoercion = v.InferOutput<
  typeof snapshotStringCoercionSchema
>;

const snapshotTemporalValueSchema = v.pipe(
  v.object({
    path: templatePathSchema,
    type: v.picklist([
      "Temporal.Instant",
      "Temporal.PlainDate",
      "Temporal.PlainYearMonth",
    ]),
  }),
  v.readonly(),
);
export type SnapshotTemporalValue = v.InferOutput<
  typeof snapshotTemporalValueSchema
>;

const snapshotGraphReferenceSchema = v.pipe(
  v.object({ path: templatePathSchema, target: templatePathSchema }),
  v.readonly(),
);
export type SnapshotGraphReference = v.InferOutput<
  typeof snapshotGraphReferenceSchema
>;

const snapshotRootDescriptorsSchema = v.pipe(
  v.object({
    stringCoercions: readonlyArray(snapshotStringCoercionSchema),
    temporalValues: readonlyArray(snapshotTemporalValueSchema),
    graphReferences: readonlyArray(snapshotGraphReferenceSchema),
  }),
  v.readonly(),
);
export type SnapshotRootDescriptors = v.InferOutput<
  typeof snapshotRootDescriptorsSchema
>;

export const snapshotLibrarySelectorSchema = v.pipe(
  v.variant("type", [
    v.object({ type: v.literal("personal") }),
    v.object({ type: v.literal("group"), groupID: v.number() }),
  ]),
  v.readonly(),
);
export type SnapshotLibrarySelector = v.InferOutput<
  typeof snapshotLibrarySelectorSchema
>;

const snapshotProvenanceSchema = v.pipe(
  v.variant("kind", [
    v.object({
      kind: v.literal("sample"),
      id: v.string(),
      source: v.optional(v.string()),
    }),
    v.object({
      kind: v.literal("connected"),
      installationId: v.string(),
      vault: v.string(),
    }),
  ]),
  v.readonly(),
);
export type SnapshotProvenance = v.InferOutput<typeof snapshotProvenanceSchema>;

const snapshotUnavailableValueSchema = v.pipe(
  v.object({ path: v.string(), reason: v.string() }),
  v.readonly(),
);
export type SnapshotUnavailableValue = v.InferOutput<
  typeof snapshotUnavailableValueSchema
>;

const jsonObjectSchema = v.record(v.string(), v.unknown());

export const itemSnapshotSchema = v.pipe(
  v.object({
    contractVersion: v.number(),
    revision: v.string(),
    item: v.pipe(
      v.object({
        key: v.string(),
        indexedKey: v.string(),
        itemType: v.string(),
        title: v.nullable(v.string()),
        library: snapshotLibrarySelectorSchema,
      }),
      v.readonly(),
    ),
    provenance: snapshotProvenanceSchema,
    roots: v.pipe(
      v.object({
        note: jsonObjectSchema,
        filename: jsonObjectSchema,
        annotations: readonlyArray(jsonObjectSchema),
      }),
      v.readonly(),
    ),
    descriptors: v.pipe(
      v.object({
        note: snapshotRootDescriptorsSchema,
        filename: snapshotRootDescriptorsSchema,
        annotations: readonlyArray(snapshotRootDescriptorsSchema),
      }),
      v.readonly(),
    ),
    unavailable: readonlyArray(snapshotUnavailableValueSchema),
    /**
     * The Item as the Items filter reads it, so that a Profile Match can be
     * tested on the snapshot. Absent in a snapshot exported before ZotLit
     * wrote it, and for an Item that is not a live top-level Item.
     */
    seed: v.optional(queryItemSeedSchema),
  }),
  v.readonly(),
);
export type ItemSnapshot = v.InferOutput<typeof itemSnapshotSchema>;
