// PROTOTYPE (#595) — throwaway. The candidate-scan / relation-loading plan families under test.
//
//   REF  oracle: full universe, per-ID hydration of everything, evaluate, sort in memory
//   A0   item-led universe scan, no pushdown, SQL default order + early stop, chunked set hydration
//   A    A0 + sound correlated-EXISTS pushdown in the universe SQL           (research family 1)
//   B    predicate-led reverse-index ID sets, JS set algebra, falls back to A0 (research family 2)
//   C    query-local Library snapshot, Library-wide loads, all in memory      (research family 3)
//   A0k  A0 without SQL ORDER BY: unordered scan + incremental top-K (no whole-Library sort step)
//   H    hybrid: reverse-index sets for selective leaves only (tag/field/coll/key/att) when the set is
//        ≤ 25% of the universe, otherwise A0k                                (research family "adaptive")
import {
  type Ast,
  comparator,
  DEFAULT_FIELDS,
  type EvalItem,
  evaluate,
  idsIn,
  isDefaultSort,
  type ItemQuery,
  lower,
  type Needs,
  needsOf,
  parse,
  project,
  RELATIONS,
  type Term,
  truthy,
  validate,
  valueParams,
} from "./core.ts";
import {
  BASE_COLS,
  type BaseRow,
  DEFAULT_ORDER_SQL,
  Meter,
  RELATION_SQL,
  type Source,
  UNIVERSE_FROM,
} from "./source.ts";

export type PlanName =
  | "REF"
  | "A0"
  | "A"
  | "B"
  | "C-cold"
  | "C-warm"
  | "A0k"
  | "H";
export const PLANS: PlanName[] = [
  "REF",
  "A0",
  "A",
  "B",
  "A0k",
  "H",
  "C-cold",
  "C-warm",
];

export interface PlanOpts {
  chunk: number;
  hydrate: "set" | "perId";
  signal?: AbortSignal;
  /** called right before the plan starts so callers can reset meters */
}

export interface QueryResult {
  rows: { key: string; values: Record<string, unknown> }[];
  returnedCount: number;
  truncated: boolean;
}

export interface RunInfo {
  result: QueryResult;
  /** whether SQL/known order allowed early termination */
  ordered: boolean;
  pushdown: string;
}

interface Prepared {
  ast: Ast | null;
  q: ItemQuery;
  evalNeeds: Needs;
  projNeeds: Needs;
}

function prepare(src: Source, q: ItemQuery): Prepared {
  const ast = q.filter === null ? null : parse(q.filter);
  if (ast) validate(ast, src.schema);
  const evalNames = new Set([...idsIn(ast), ...q.sort.map((s) => s.field)]);
  return {
    ast,
    q,
    evalNeeds: needsOf(evalNames, src.schema),
    projNeeds: needsOf(q.fields.length ? q.fields : DEFAULT_FIELDS, src.schema),
  };
}

async function pipeline(
  src: Source,
  p: Prepared,
  chunks: Iterable<EvalItem[]>,
  ordered: boolean,
  opts: PlanOpts,
  evalNeeds: Needs = p.evalNeeds,
  topK = false,
): Promise<QueryResult> {
  const { q, ast } = p;
  const m = src.meter;
  let matches: EvalItem[] = [];
  const cmp = comparator(q.sort);
  // top-K: keep at most 2(limit+1) matches, compacting per chunk, so no step sorts the whole Library
  const keep = topK && q.limit !== null ? q.limit + 1 : null;
  let seen = 0;
  for (const chunk of chunks) {
    src.hydrate(chunk, evalNeeds, opts.hydrate);
    for (const it of chunk)
      if (!ast || truthy(evaluate(ast, it))) {
        matches.push(it);
        seen++;
      }
    if (keep !== null && matches.length > 2 * keep)
      matches = matches.sort(cmp).slice(0, keep);
    await m.yield();
    if (ordered && q.limit !== null && matches.length > q.limit) break;
  }
  if (!ordered) matches.sort(cmp);
  const truncated =
    q.limit !== null && (keep !== null ? seen : matches.length) > q.limit;
  const winners = q.limit === null ? matches : matches.slice(0, q.limit);
  for (let i = 0; i < winners.length; i += opts.chunk) {
    src.hydrate(winners.slice(i, i + opts.chunk), p.projNeeds, "set");
    await m.yield();
  }
  const paths = q.fields.length ? q.fields : DEFAULT_FIELDS;
  const rows = winners.map((it) => ({
    key: it.key,
    values: project(it, paths),
  }));
  return { rows, returnedCount: rows.length, truncated };
}

function* chunked<T>(it: Iterable<T>, n: number): Generator<T[]> {
  let buf: T[] = [];
  for (const x of it) {
    buf.push(x);
    if (buf.length >= n) {
      yield buf;
      buf = [];
    }
  }
  if (buf.length) yield buf;
}

// ------------------------------------------------------------------ REF

async function runREF(
  src: Source,
  lib: number,
  p: Prepared,
  opts: PlanOpts,
): Promise<RunInfo> {
  const all = src.iterate<BaseRow>(`SELECT ${BASE_COLS} ${UNIVERSE_FROM}`, [
    lib,
  ]);
  const chunks = (function* () {
    for (const c of chunked(all, opts.chunk)) yield c.map((r) => src.toItem(r));
  })();
  const everything: Needs = { fields: "all", relations: new Set(RELATIONS) };
  const result = await pipeline(
    src,
    p,
    chunks,
    false,
    { ...opts, hydrate: "perId" },
    everything,
  );
  return { result, ordered: false, pushdown: "none" };
}

// ------------------------------------------------------------------ A0 / A

export function termSql(t: Term): { sql: string; params: unknown[] } {
  switch (t.k) {
    case "all":
      return { sql: "1", params: [] };
    case "and":
    case "or": {
      const parts = t.xs.map(termSql);
      return {
        sql: `(${parts.map((x) => x.sql).join(t.k === "and" ? " AND " : " OR ")})`,
        params: parts.flatMap((x) => x.params),
      };
    }
    case "not": {
      const x = termSql(t.x);
      return { sql: `NOT (${x.sql})`, params: x.params };
    }
    case "type":
      return { sql: "t.typeName = ?", params: [t.name] };
    case "key":
      return { sql: "i.key = ?", params: [t.key] };
    case "att":
      return {
        sql: `EXISTS (SELECT 1 FROM itemAttachments AS a WHERE a.parentItemID = i.itemID AND NOT EXISTS (SELECT 1 FROM deletedItems AS y WHERE y.itemID = a.itemID))`,
        params: [],
      };
    case "tag":
      return {
        sql: `EXISTS (SELECT 1 FROM itemTags AS it JOIN tags AS tg ON tg.tagID = it.tagID WHERE it.itemID = i.itemID AND tg.name = ?)`,
        params: [t.name],
      };
    case "coll":
      return {
        sql: `EXISTS (SELECT 1 FROM collectionItems AS ci JOIN collections AS c ON c.collectionID = ci.collectionID WHERE ci.itemID = i.itemID AND c.collectionName = ? AND NOT EXISTS (SELECT 1 FROM deletedCollections AS dc WHERE dc.collectionID = c.collectionID))`,
        params: [t.name],
      };
    case "field": {
      const vp = valueParams(t.value);
      return {
        sql: `EXISTS (SELECT 1 FROM itemData AS d JOIN itemDataValues AS v ON v.valueID = d.valueID WHERE d.itemID = i.itemID AND d.fieldID IN (${t.fieldIDs.join(",")}) AND v.value IN (${vp.map(() => "?").join(",")}))`,
        params: vp,
      };
    }
  }
}

export function universeSql(
  p: Prepared,
  pushdown: boolean,
  src: Source,
  unordered = false,
) {
  const ordered = !unordered && isDefaultSort(p.q.sort);
  const t = pushdown ? lower(p.ast, src.schema).term : ({ k: "all" } as Term);
  const w = termSql(t);
  return {
    sql: `SELECT ${BASE_COLS} ${UNIVERSE_FROM} AND ${w.sql} ${ordered ? DEFAULT_ORDER_SQL : ""}`,
    params: w.params,
    ordered,
    term: t,
  };
}

async function runA(
  src: Source,
  lib: number,
  p: Prepared,
  opts: PlanOpts,
  pushdown: boolean,
  topK = false,
): Promise<RunInfo> {
  const u = universeSql(p, pushdown, src, topK);
  const rows = src.iterate<BaseRow>(u.sql, [lib, ...u.params]);
  const chunks = (function* () {
    for (const c of chunked(rows, opts.chunk))
      yield c.map((r) => src.toItem(r));
  })();
  const result = await pipeline(
    src,
    p,
    chunks,
    u.ordered,
    opts,
    p.evalNeeds,
    topK,
  );
  return {
    result,
    ordered: u.ordered,
    pushdown:
      (u.term.k === "all" ? "none" : describe(u.term)) + (topK ? "+topK" : ""),
  };
}

export function describe(t: Term): string {
  switch (t.k) {
    case "and":
    case "or":
      return `(${t.xs.map(describe).join(` ${t.k} `)})`;
    case "not":
      return `not ${describe(t.x)}`;
    default:
      return t.k;
  }
}

// ------------------------------------------------------------------ B

export function leafSql(
  t: Term,
  lib: number,
): { sql: string; params: unknown[] } | null {
  switch (t.k) {
    case "type":
      return {
        sql: `SELECT i.itemID FROM items AS i JOIN itemTypes AS t ON t.itemTypeID = i.itemTypeID WHERE i.libraryID = ? AND t.typeName = ?`,
        params: [lib, t.name],
      };
    case "key":
      return {
        sql: `SELECT itemID FROM items WHERE libraryID = ? AND key = ?`,
        params: [lib, t.key],
      };
    case "tag":
      return {
        sql: `SELECT it.itemID FROM tags AS tg JOIN itemTags AS it ON it.tagID = tg.tagID WHERE tg.name = ?`,
        params: [t.name],
      };
    case "coll":
      return {
        sql: `SELECT ci.itemID FROM collections AS c JOIN collectionItems AS ci ON ci.collectionID = c.collectionID WHERE c.libraryID = ? AND c.collectionName = ? AND NOT EXISTS (SELECT 1 FROM deletedCollections AS dc WHERE dc.collectionID = c.collectionID)`,
        params: [lib, t.name],
      };
    case "att":
      return {
        sql: `SELECT DISTINCT a.parentItemID AS itemID FROM itemAttachments AS a WHERE a.parentItemID IS NOT NULL AND NOT EXISTS (SELECT 1 FROM deletedItems AS y WHERE y.itemID = a.itemID)`,
        params: [],
      };
    case "field": {
      const vp = valueParams(t.value);
      return {
        sql: `SELECT d.itemID FROM itemDataValues AS v JOIN itemData AS d ON d.valueID = v.valueID WHERE v.value IN (${vp.map(() => "?").join(",")}) AND d.fieldID IN (${t.fieldIDs.join(",")})`,
        params: vp,
      };
    }
    default:
      return null;
  }
}

function termSet(
  src: Source,
  lib: number,
  t: Term,
  universe: () => Set<number>,
): Set<number> | "all" {
  if (t.k === "all") return "all";
  if (t.k === "and") {
    let acc: Set<number> | "all" = "all";
    // smallest first keeps intersections cheap
    const sets = t.xs
      .map((x) => termSet(src, lib, x, universe))
      .sort((a, b) => (a === "all" ? 1 : b === "all" ? -1 : a.size - b.size));
    for (const s of sets)
      acc =
        acc === "all"
          ? s
          : s === "all"
            ? acc
            : new Set([...acc].filter((x) => s.has(x)));
    return acc;
  }
  if (t.k === "or") {
    const out = new Set<number>();
    for (const x of t.xs) {
      const s = termSet(src, lib, x, universe);
      if (s === "all") return "all";
      for (const id of s) out.add(id);
    }
    return out;
  }
  if (t.k === "not") {
    const s = termSet(src, lib, t.x, universe);
    if (s === "all") return new Set();
    return new Set([...universe()].filter((id) => !s.has(id)));
  }
  const q = leafSql(t, lib)!;
  return new Set(
    src.all<{ itemID: number }>(q.sql, q.params).map((r) => r.itemID),
  );
}

async function runB(
  src: Source,
  lib: number,
  p: Prepared,
  opts: PlanOpts,
): Promise<RunInfo> {
  const { term } = lower(p.ast, src.schema);
  let universeCache: Set<number> | undefined;
  const universe = () =>
    (universeCache ??= new Set(
      src
        .all<{ id: number }>(`SELECT i.itemID AS id ${UNIVERSE_FROM}`, [lib])
        .map((r) => r.id),
    ));
  const set = termSet(src, lib, term, universe);
  if (set === "all") {
    const r = await runA(src, lib, p, opts, false);
    return { ...r, pushdown: "fallback:A0" };
  }
  await src.meter.yield();
  const r = await fromSet(src, lib, p, opts, set);
  return { ...r, pushdown: describe(term) };
}

async function fromSet(
  src: Source,
  lib: number,
  p: Prepared,
  opts: PlanOpts,
  set: Set<number>,
): Promise<RunInfo> {
  // restrict to the universe and fetch order keys
  const base: BaseRow[] = [];
  const ids = [...set];
  for (let i = 0; i < ids.length; i += 4000) {
    const part = ids.slice(i, i + 4000);
    base.push(
      ...src.all<BaseRow>(
        `SELECT ${BASE_COLS} ${UNIVERSE_FROM} AND i.itemID IN (${part.map(() => "?").join(",")})`,
        [lib, ...part],
      ),
    );
    await src.meter.yield();
  }
  const ordered = isDefaultSort(p.q.sort);
  const items = base.map((r) => src.toItem(r));
  if (ordered) items.sort(comparator(p.q.sort));
  const result = await pipeline(
    src,
    p,
    chunked(items, opts.chunk),
    ordered,
    opts,
  );
  return { result, ordered, pushdown: "" };
}

// ------------------------------------------------------------------ H (hybrid)

/** Keep only leaves with a selective reverse index; type and negation stay in the evaluator. */
function selectiveOnly(t: Term): Term {
  switch (t.k) {
    case "type":
    case "not":
    case "all":
      return { k: "all" };
    case "and": {
      const xs = t.xs.map(selectiveOnly).filter((x) => x.k !== "all");
      return xs.length === 0
        ? { k: "all" }
        : xs.length === 1
          ? xs[0]!
          : { k: "and", xs };
    }
    case "or": {
      const xs = t.xs.map(selectiveOnly);
      return xs.some((x) => x.k === "all") ? { k: "all" } : { k: "or", xs };
    }
    default:
      return t;
  }
}

export const H_MAX_FRACTION = 0.25;

async function runH(
  src: Source,
  lib: number,
  p: Prepared,
  opts: PlanOpts,
): Promise<RunInfo> {
  const term = selectiveOnly(lower(p.ast, src.schema).term);
  if (term.k !== "all") {
    const set = termSet(src, lib, term, () => {
      throw new Error("unreachable: no negation");
    });
    // cheap estimate: every Item row in the Library, via the (libraryID, key) index only
    const universe = src.all<{ n: number }>(
      `SELECT count(*) AS n FROM items WHERE libraryID = ?`,
      [lib],
    )[0]!.n;
    if (set !== "all" && set.size <= universe * H_MAX_FRACTION) {
      const r = await fromSet(src, lib, p, opts, set);
      return { ...r, pushdown: `set:${describe(term)}` };
    }
    await src.meter.yield();
  }
  const r = await runA(src, lib, p, opts, false, true);
  return {
    ...r,
    pushdown: `scan+topK${term.k === "all" ? "" : " (set too large)"}`,
  };
}

// ------------------------------------------------------------------ C

const snapshots = new Map<
  string,
  { items: EvalItem[]; byDefault?: EvalItem[] }
>();
export function dropSnapshots() {
  snapshots.clear();
}

async function buildSnapshot(src: Source, lib: number): Promise<EvalItem[]> {
  const m = src.meter;
  const items: EvalItem[] = [];
  const byId = new Map<number, EvalItem>();
  let n = 0;
  const tick = async () => {
    if (++n % 5000 === 0) await m.yield();
  };
  for (const r of src.iterate<BaseRow>(`SELECT ${BASE_COLS} ${UNIVERSE_FROM}`, [
    lib,
  ])) {
    const it = src.toItem(r);
    it.loadedFieldIDs = "all";
    it.creators = [];
    it.tags = [];
    it.collections = [];
    it.hasAttachment = false;
    items.push(it);
    byId.set(it.id, it);
    await tick();
  }
  const sub = `SELECT i.itemID ${UNIVERSE_FROM}`;
  for (const r of src.iterate<any>(
    `SELECT d.itemID, d.fieldID, v.value FROM itemData AS d JOIN itemDataValues AS v ON v.valueID = d.valueID WHERE d.itemID IN (${sub})`,
    [lib],
  )) {
    src.setField(byId.get(r.itemID)!, r.fieldID, r.value);
    await tick();
  }
  for (const rel of RELATIONS) {
    for (const r of src.iterate<any>(RELATION_SQL[rel](sub), [lib])) {
      const it = byId.get(r.itemID)!;
      if (rel === "hasAttachment") it.hasAttachment = true;
      else if (rel === "creators")
        it.creators!.push({
          firstName: r.firstName ?? "",
          lastName: r.lastName ?? "",
          fieldMode: r.fieldMode,
          creatorType: r.creatorType,
        });
      else it[rel]!.push(r.name);
      await tick();
    }
  }
  for (const it of items) {
    it.tags!.sort();
    it.collections!.sort();
  }
  m.hydrated += items.length;
  return items;
}

async function runC(
  src: Source,
  lib: number,
  p: Prepared,
  opts: PlanOpts,
  warm: boolean,
): Promise<RunInfo> {
  const key = `${src.path}:${lib}`;
  let snap = warm ? snapshots.get(key) : undefined;
  if (!snap) {
    snap = { items: await buildSnapshot(src, lib) };
    snapshots.set(key, snap);
  }
  const ordered = isDefaultSort(p.q.sort);
  // the snapshot keeps a default-order copy so default-sorted limited queries can stop early
  const source = ordered
    ? (snap.byDefault ??= [...snap.items].sort(comparator(p.q.sort)))
    : snap.items;
  const result = await pipeline(
    src,
    p,
    chunked(source, opts.chunk),
    ordered,
    opts,
  );
  return { result, ordered, pushdown: "n/a" };
}

// ------------------------------------------------------------------ entry

export async function runPlan(
  plan: PlanName,
  src: Source,
  lib: number,
  q: ItemQuery,
  opts: PlanOpts,
): Promise<RunInfo & { meter: Meter }> {
  src.meter = new Meter(opts.signal);
  const p = prepare(src, q);
  let info: RunInfo;
  switch (plan) {
    case "REF":
      info = await runREF(src, lib, p, opts);
      break;
    case "A0":
      info = await runA(src, lib, p, opts, false);
      break;
    case "A":
      info = await runA(src, lib, p, opts, true);
      break;
    case "B":
      info = await runB(src, lib, p, opts);
      break;
    case "A0k":
      info = await runA(src, lib, p, opts, false, true);
      break;
    case "H":
      info = await runH(src, lib, p, opts);
      break;
    case "C-cold":
      info = await runC(src, lib, p, opts, false);
      break;
    case "C-warm":
      info = await runC(src, lib, p, opts, true);
      break;
  }
  src.meter.finish();
  return { ...info, meter: src.meter };
}
