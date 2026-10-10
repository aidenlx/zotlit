import { Context } from "effect";

import { HYDRATE_CHUNK_SIZE, SCAN_PAGE_SIZE } from "@zotlit/db/item-query";

/**
 * The internal tuning of the engine. Every value changes speed only; each one
 * gives the identical Query Result. It is not an option of `collectQuery` or `consumeQuery`.
 */
export interface Tuning {
  /**
   * The candidate cap as a share of the Library's `items` row count. The
   * engine uses a candidate set that holds at most this share, and the scan
   * for a larger one.
   */
  readonly capRatio: number;
  /** Element pages per Relation List candidate read in one Target Library. */
  readonly relationPageBudget: number;
  /**
   * The Items of one scan page and of one universe chunk. The readers hold it
   * at `SCAN_PAGE_SIZE` at most.
   */
  readonly scanPageSize: number;
  /**
   * The Items of one hydrate chunk. The reader holds it at
   * `HYDRATE_CHUNK_SIZE` at most.
   */
  readonly hydrateChunkSize: number;
  /** The rows one merge step of an unlimited query moves at most. */
  readonly mergeStepSize: number;
  /** Read every Item with the scan, whatever candidate sets the filter gives. */
  readonly forceScan: boolean;
}

/** The production tuning. The measurement record can change these values. */
export const PRODUCTION_TUNING: Tuning = {
  capRatio: 0.25,
  relationPageBudget: 4,
  scanPageSize: SCAN_PAGE_SIZE,
  hydrateChunkSize: HYDRATE_CHUNK_SIZE,
  mergeStepSize: 500,
  forceScan: false,
};

/**
 * The tuning reference of one run, with {@link PRODUCTION_TUNING} as its
 * default. A test provides another value; the Obsidian adapter provides none.
 */
export const ItemQueryTuning = Context.Reference<Tuning>(
  "@zotlit/item-query/ItemQueryTuning",
  { defaultValue: () => PRODUCTION_TUNING },
);
