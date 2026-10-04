// PROTOTYPE (#595) — throwaway. Raw node:sqlite access with statement/row/slice metering.
import { DatabaseSync, type StatementSync } from "node:sqlite";

import {
  type EvalItem,
  type Needs,
  type Relation,
  type Schema,
} from "./core.ts";

export class Cancelled extends Error {}

/** Counts statements and rows, and measures synchronous slices between cooperative yields. */
export class Meter {
  statements = 0;
  rows = 0;
  hydrated = 0;
  maxSliceMs = 0;
  slices = 0;
  peakHeap = 0;
  private last = performance.now();
  private readonly baseHeap: number;
  private readonly signal?: AbortSignal;
  constructor(signal?: AbortSignal) {
    this.signal = signal;
    this.baseHeap = process.memoryUsage().heapUsed;
  }
  sample() {
    const h = process.memoryUsage().heapUsed - this.baseHeap;
    if (h > this.peakHeap) this.peakHeap = h;
  }
  async yield() {
    const now = performance.now();
    this.maxSliceMs = Math.max(this.maxSliceMs, now - this.last);
    this.slices++;
    this.sample();
    await new Promise((r) => setImmediate(r));
    if (this.signal?.aborted) throw new Cancelled();
    this.last = performance.now();
  }
  finish() {
    this.maxSliceMs = Math.max(this.maxSliceMs, performance.now() - this.last);
    this.sample();
  }
}

export interface BaseRow {
  id: number;
  key: string;
  itemTypeID: number;
  itemType: string;
  dateAdded: string;
  dateModified: string;
}

export const UNIVERSE_FROM = `
  FROM items AS i JOIN itemTypes AS t ON t.itemTypeID = i.itemTypeID
  WHERE i.libraryID = ? AND t.typeName NOT IN ('attachment', 'note', 'annotation')
    AND NOT EXISTS (SELECT 1 FROM deletedItems AS x WHERE x.itemID = i.itemID)`;
export const BASE_COLS = `i.itemID AS id, i.key, i.itemTypeID, t.typeName AS itemType, i.dateAdded, i.dateModified`;
export const DEFAULT_ORDER_SQL = `ORDER BY i.dateModified DESC, i.key ASC`;

const ph = (n: number) => Array(n).fill("?").join(",");

export class Source {
  db: DatabaseSync;
  schema: Schema;
  meter = new Meter();
  private readonly cache = new Map<string, StatementSync>();
  path: string;
  constructor(path: string) {
    this.path = path;
    this.db = new DatabaseSync(path, { readOnly: true });
    this.schema = this.loadSchema();
  }

  stmt(sql: string): StatementSync {
    let s = this.cache.get(sql);
    if (!s) this.cache.set(sql, (s = this.db.prepare(sql)));
    return s;
  }
  all<T>(sql: string, params: unknown[]): T[] {
    this.meter.statements++;
    const rows = this.stmt(sql).all(...(params as never[])) as T[];
    this.meter.rows += rows.length;
    return rows;
  }
  *iterate<T>(sql: string, params: unknown[]): Generator<T> {
    this.meter.statements++;
    for (const r of this.stmt(sql).iterate(...(params as never[]))) {
      this.meter.rows++;
      yield r as T;
    }
  }
  eqp(sql: string, params: unknown[]): string {
    return (
      this.db
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .all(...(params as never[])) as { detail: string }[]
    )
      .map((r) => r.detail)
      .join("\n");
  }

  private loadSchema(): Schema {
    const fieldID = new Map<string, number>(),
      fieldName = new Map<number, string>();
    for (const r of this.db
      .prepare(`SELECT fieldID, fieldName FROM fieldsCombined WHERE custom = 0`)
      .all() as any[]) {
      fieldID.set(r.fieldName, r.fieldID);
      fieldName.set(r.fieldID, r.fieldName);
    }
    const answers = new Map<string, number[]>();
    for (const [n, id] of fieldID) answers.set(n, [id]);
    const aliasOf = new Map<string, string>();
    for (const r of this.db
      .prepare(
        `SELECT itemTypeID, baseFieldID, fieldID FROM baseFieldMappingsCombined`,
      )
      .all() as any[]) {
      const base = fieldName.get(r.baseFieldID);
      if (!base) continue;
      aliasOf.set(`${r.itemTypeID}:${r.fieldID}`, base);
      const a = answers.get(base)!;
      if (!a.includes(r.fieldID)) a.push(r.fieldID);
    }
    const dateLike = new Set(["date", "accessDate"]);
    for (const [k, base] of aliasOf)
      if (base === "date")
        dateLike.add(fieldName.get(Number(k.split(":")[1]))!);
    return { fieldID, fieldName, answers, aliasOf, dateLike };
  }

  libraryOf(type: "user" | "group"): number | undefined {
    return (
      this.db
        .prepare(
          `SELECT libraryID FROM libraries WHERE type = ? ORDER BY libraryID LIMIT 1`,
        )
        .get(type) as any
    )?.libraryID;
  }

  toItem(r: BaseRow): EvalItem {
    return { ...r, fields: new Map(), loadedFieldIDs: new Set() };
  }

  setField(item: EvalItem, fieldID: number, value: unknown) {
    const v = String(value);
    const name = this.schema.fieldName.get(fieldID);
    if (!name) return; // custom field — out of prototype scope
    item.fields.set(name, v);
    const base = this.schema.aliasOf.get(`${item.itemTypeID}:${fieldID}`);
    if (base) item.fields.set(base, v);
  }

  // ------------------------------------------------------------ hydration

  /** Fill only what `needs` asks for and the item does not have yet. */
  hydrate(items: EvalItem[], needs: Needs, mode: "set" | "perId") {
    if (items.length === 0) return;
    this.meter.hydrated += items.length;
    const byId = new Map(items.map((i) => [i.id, i]));
    const missingFields = (i: EvalItem): number[] | "all" | null => {
      if (i.loadedFieldIDs === "all") return null;
      if (needs.fields === "all") return "all";
      const m = [...needs.fields].filter(
        (f) => !(i.loadedFieldIDs as Set<number>).has(f),
      );
      return m.length ? m : null;
    };
    const fieldTargets = items.filter((i) => missingFields(i) !== null);
    if (fieldTargets.length) {
      const want = needs.fields === "all" ? null : [...needs.fields];
      this.load(
        fieldTargets.map((i) => i.id),
        mode,
        (ids) =>
          `SELECT d.itemID, d.fieldID, v.value FROM itemData AS d JOIN itemDataValues AS v ON v.valueID = d.valueID
         WHERE d.itemID IN (${ids})${want ? ` AND d.fieldID IN (${want.join(",")})` : ""}`,
      ).forEach((r: any) =>
        this.setField(byId.get(r.itemID)!, r.fieldID, r.value),
      );
      for (const i of fieldTargets) {
        if (want === null) i.loadedFieldIDs = "all";
        else for (const f of want) (i.loadedFieldIDs as Set<number>).add(f);
      }
    }
    for (const rel of needs.relations) {
      const targets = items.filter((i) => i[rel] === undefined);
      if (!targets.length) continue;
      this.loadRelation(rel, targets, byId, (ids) =>
        this.load(ids, mode, RELATION_SQL[rel]),
      );
    }
  }

  private load(
    ids: number[],
    mode: "set" | "perId",
    sql: (ph: string) => string,
  ): unknown[] {
    if (mode === "set") return this.all(sql(ph(ids.length)), ids);
    const s = sql("?");
    return ids.flatMap((id) => this.all(s, [id]));
  }

  loadRelation(
    rel: Relation,
    targets: EvalItem[],
    byId: Map<number, EvalItem>,
    rows: (ids: number[]) => unknown[],
  ) {
    if (rel === "hasAttachment") {
      for (const t of targets) t.hasAttachment = false;
      for (const r of rows(targets.map((t) => t.id)) as any[]) {
        const it = byId.get(r.itemID);
        if (it) it.hasAttachment = true;
      }
      return;
    }
    for (const t of targets) t[rel] = [] as never;
    for (const r of rows(targets.map((t) => t.id)) as any[]) {
      const it = byId.get(r.itemID);
      if (!it) continue;
      if (rel === "creators")
        it.creators!.push({
          firstName: r.firstName ?? "",
          lastName: r.lastName ?? "",
          fieldMode: r.fieldMode,
          creatorType: r.creatorType,
        });
      else it[rel]!.push(r.name);
    }
    if (rel === "tags" || rel === "collections")
      for (const t of targets) t[rel]!.sort();
  }
}

/** Item-led relation queries; `ids` is a placeholder list (or a subquery for Library-wide loads). */
export const RELATION_SQL: Record<Relation, (ids: string) => string> = {
  creators: (
    ids,
  ) => `SELECT ic.itemID, c.firstName, c.lastName, c.fieldMode, ct.creatorType
    FROM itemCreators AS ic JOIN creators AS c ON c.creatorID = ic.creatorID
    JOIN creatorTypes AS ct ON ct.creatorTypeID = ic.creatorTypeID
    WHERE ic.itemID IN (${ids}) ORDER BY ic.itemID, ic.orderIndex`,
  tags: (ids) =>
    `SELECT it.itemID, t.name FROM itemTags AS it JOIN tags AS t ON t.tagID = it.tagID WHERE it.itemID IN (${ids})`,
  collections: (
    ids,
  ) => `SELECT ci.itemID, c.collectionName AS name FROM collectionItems AS ci
    JOIN collections AS c ON c.collectionID = ci.collectionID
    WHERE ci.itemID IN (${ids}) AND NOT EXISTS (SELECT 1 FROM deletedCollections AS dc WHERE dc.collectionID = c.collectionID)`,
  hasAttachment: (
    ids,
  ) => `SELECT DISTINCT a.parentItemID AS itemID FROM itemAttachments AS a
    WHERE a.parentItemID IN (${ids}) AND NOT EXISTS (SELECT 1 FROM deletedItems AS x WHERE x.itemID = a.itemID)`,
};
