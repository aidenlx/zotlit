// PROTOTYPE (#595) — throwaway benchmark runner.
//   pnpm prototype:item-query            full run (≈10 min)
//   pnpm prototype:item-query --quick    1 timed run per plan, smaller sweeps
//   pnpm prototype:item-query --fresh    rebuild every scratch database first
// Writes results/results.json and results/RESULTS.md next to this file. Real-Library query
// literals are picked by selectivity and never written out — only aggregate counts.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { type ItemQuery, lower, parse } from "./core.ts";
import { ensureFixtures } from "./fixtures.ts";
import {
  dropSnapshots,
  leafSql,
  type PlanName,
  PLANS,
  type QueryResult,
  runPlan,
  universeSql,
} from "./plans.ts";
import {
  BASE_COLS,
  Cancelled,
  DEFAULT_ORDER_SQL,
  Source,
  UNIVERSE_FROM,
} from "./source.ts";

const argv = new Set(process.argv.slice(2));
const QUICK = argv.has("--quick");
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const RUNS = QUICK ? 1 : 5;
const CHUNK = 250;
const gc = (globalThis as { gc?: () => void }).gc ?? (() => {});
const OUT = join(import.meta.dirname, "results");

// ------------------------------------------------------------------ query suite

interface Picks {
  rareTitle?: string;
  commonPub?: string;
  domType?: string;
  rareTag?: string;
  commonTag?: string;
  coll?: string;
  creator?: string;
  counts: Record<string, number>;
}

function pick(src: Source, lib: number): Picks {
  const one = <T>(sql: string, params: unknown[] = []) =>
    src.db.prepare(sql).get(...(params as never[])) as T | undefined;
  const U = `SELECT i.itemID ${UNIVERSE_FROM}`;
  const f = (n: string) => src.schema.answers.get(n)!.join(",");
  const counts: Record<string, number> = {};
  const p: Picks = { counts };
  const set = (
    k: keyof Omit<Picks, "counts">,
    r: { v: string; n: number } | undefined,
  ) => {
    if (r) {
      p[k] = r.v;
      counts[k] = r.n;
    }
  };
  set(
    "rareTitle",
    one(
      `SELECT v.value AS v, count(*) AS n FROM itemData d JOIN itemDataValues v USING (valueID) WHERE d.fieldID IN (${f("title")}) AND d.itemID IN (${U}) GROUP BY v.value HAVING n = 1 ORDER BY min(d.itemID) LIMIT 1 OFFSET 7`,
      [lib],
    ),
  );
  set(
    "commonPub",
    one(
      `SELECT v.value AS v, count(*) AS n FROM itemData d JOIN itemDataValues v USING (valueID) WHERE d.fieldID IN (${f("publicationTitle")}) AND d.itemID IN (${U}) GROUP BY v.value ORDER BY n DESC, v.value LIMIT 1`,
      [lib],
    ),
  );
  set(
    "domType",
    one(
      `SELECT t.typeName AS v, count(*) AS n ${UNIVERSE_FROM} GROUP BY t.typeName ORDER BY n DESC LIMIT 1`,
      [lib],
    ),
  );
  set(
    "rareTag",
    one(
      `SELECT tg.name AS v, count(*) AS n FROM itemTags it JOIN tags tg USING (tagID) WHERE it.itemID IN (${U}) GROUP BY tg.name HAVING n BETWEEN 2 AND 5 ORDER BY min(tg.tagID) LIMIT 1`,
      [lib],
    ),
  );
  set(
    "commonTag",
    one(
      `SELECT tg.name AS v, count(*) AS n FROM itemTags it JOIN tags tg USING (tagID) WHERE it.itemID IN (${U}) GROUP BY tg.name ORDER BY n DESC, tg.name LIMIT 1`,
      [lib],
    ),
  );
  set(
    "coll",
    one(
      `SELECT c.collectionName AS v, count(*) AS n FROM collectionItems ci JOIN collections c USING (collectionID) WHERE ci.itemID IN (${U}) AND c.libraryID = ? AND c.collectionID NOT IN (SELECT collectionID FROM deletedCollections) GROUP BY c.collectionName ORDER BY n DESC, c.collectionName LIMIT 1`,
      [lib, lib],
    ),
  );
  set(
    "creator",
    one(
      `SELECT trim(c.firstName || ' ' || c.lastName) AS v, count(*) AS n FROM itemCreators ic JOIN creators c USING (creatorID) WHERE ic.itemID IN (${U}) AND c.fieldMode = 0 GROUP BY v ORDER BY n DESC, v LIMIT 1`,
      [lib],
    ),
  );
  counts.universe = one<{ n: number }>(
    `SELECT count(*) AS n ${UNIVERSE_FROM}`,
    [lib],
  )!.n;
  counts.hasAttachment = one<{ n: number }>(
    `SELECT count(DISTINCT a.parentItemID) AS n FROM itemAttachments a WHERE a.parentItemID IN (${U}) AND a.itemID NOT IN (SELECT itemID FROM deletedItems)`,
    [lib],
  )!.n;
  return p;
}

interface Case {
  id: string;
  shape: string;
  q: ItemQuery;
}

const lit = (s: string) => JSON.stringify(s);

function suite(p: Picks): Case[] {
  const c = (
    id: string,
    shape: string,
    filter: string | null,
    limit: number | null = 100,
    sort: ItemQuery["sort"] = [{ field: "dateModified", direction: "desc" }],
  ): Case => ({ id, shape, q: { filter, sort, fields: [], limit } });
  const out: Case[] = [
    c("all.100", "match all, default order, limit 100", null),
    c("all.all", "match all, default order, limit=all", null, null),
    c(
      "sort.title.100",
      "match all, title asc (in-memory sort), limit 100",
      null,
      100,
      [{ field: "title", direction: "asc" }],
    ),
    c(
      "contains.title",
      'title.lower().contains("the") (no pushdown)',
      `title.lower().contains("the")`,
    ),
  ];
  if (p.rareTitle)
    out.push(
      c(
        "eq.title.rare",
        `title == <unique title>`,
        `title == ${lit(p.rareTitle)}`,
      ),
    );
  if (p.commonPub)
    out.push(
      c(
        "eq.pub.common",
        `publicationTitle == <most common venue> (alias)`,
        `publicationTitle == ${lit(p.commonPub)}`,
      ),
    );
  if (p.domType) {
    out.push(
      c(
        "eq.type.dominant",
        `itemType == <dominant type>`,
        `itemType == ${lit(p.domType)}`,
      ),
    );
    out.push(
      c(
        "eq.type.dominant.all",
        `itemType == <dominant type>, limit=all`,
        `itemType == ${lit(p.domType)}`,
        null,
      ),
    );
  }
  if (p.rareTag)
    out.push(
      c(
        "tag.rare",
        `tags.contains(<tag on 2-5 Items>)`,
        `tags.contains(${lit(p.rareTag)})`,
      ),
    );
  if (p.commonTag) {
    out.push(
      c(
        "tag.common",
        `tags.contains(<most common tag>)`,
        `tags.contains(${lit(p.commonTag)})`,
      ),
    );
    out.push(
      c(
        "not.tag.common",
        `!tags.contains(<most common tag>)`,
        `!tags.contains(${lit(p.commonTag)})`,
      ),
    );
    out.push(
      c(
        "and.tag.contains",
        `tags.contains(<common>) && title.lower().contains("a")`,
        `tags.contains(${lit(p.commonTag)}) && title.lower().contains("a")`,
      ),
    );
    out.push(
      c(
        "tag.common.sort.title.all",
        `tags.contains(<common>), title asc, limit=all`,
        `tags.contains(${lit(p.commonTag)})`,
        null,
        [{ field: "title", direction: "asc" }],
      ),
    );
  }
  if (p.rareTag && p.rareTitle)
    out.push(
      c(
        "or.rare",
        `tags.contains(<rare>) || title == <unique>`,
        `tags.contains(${lit(p.rareTag)}) || title == ${lit(p.rareTitle)}`,
      ),
    );
  if (p.coll)
    out.push(
      c(
        "coll",
        `collections.contains(<largest collection>)`,
        `collections.contains(${lit(p.coll)})`,
      ),
    );
  out.push(c("att", `hasAttachment`, `hasAttachment`));
  if (p.creator)
    out.push(
      c(
        "creator.eq",
        `creators.contains(<most common creator>) (no pushdown)`,
        `creators.contains(${lit(p.creator)})`,
      ),
    );
  return out;
}

function scenarioSuite(): Case[] {
  const c = (
    id: string,
    filter: string | null,
    limit: number | null = 100,
    sort: ItemQuery["sort"] = [{ field: "dateModified", direction: "desc" }],
  ): Case => ({
    id,
    shape: filter ?? "(none)",
    q: { filter, sort, fields: [], limit },
  });
  return [
    c("numeric-storage", `volume == "12"`),
    c("like-percent", `title.contains("%")`),
    c("like-underscore", `title.contains("_")`),
    c("backslash", `title.contains("\\\\")`),
    c("unicode", `title.lower().contains("i̇stanbul")`),
    c("not-att", `!hasAttachment`),
    c("not-coll", `!collections.contains("Dup")`),
    c("dup-coll", `collections.contains("Dup")`),
    c("tag-case", `tags.contains("alpha")`),
    c("tag-auto", `tags.contains("Alpha")`),
    c("alias", `publicationTitle == "Proc"`),
    c("alias-or-extra", `publicationTitle == "Proc" || extra == "Proc"`),
    c("type-note", `itemType == "note"`),
    c("key", `key == "SCN00001"`),
    c("ties.limit1", `title == "Tie A"`, 1),
    c("ties.limit2", `title == "Tie A"`, 2),
    c("ties.limit3", `title == "Tie A"`, 3),
    c("ties.limit4", `title == "Tie A"`, 4),
    c("ties.all", `title == "Tie A"`, null),
    c("sort.title.asc", null, null, [{ field: "title", direction: "asc" }]),
    c("sort.title.desc", null, null, [{ field: "title", direction: "desc" }]),
    c("sort.title.limit2", null, 2, [{ field: "title", direction: "asc" }]),
    c("default.limit3", null, 3),
    c("not-and", `!(tags.contains("Alpha") && hasAttachment)`),
    c("or-mixed", `tags.contains("Beta") || title.contains("Sure")`),
    c("creator-dup", `creators.contains("Ada Lovelace")`),
  ];
}

// ------------------------------------------------------------------ measurement

const fingerprint = (r: QueryResult) => JSON.stringify(r);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};
const mb = (b: number) => Math.round((b / 2 ** 20) * 10) / 10;
const r1 = (x: number) => Math.round(x * 10) / 10;

interface Row {
  db: string;
  lib: string;
  caseId: string;
  plan: PlanName;
  ms: number;
  msMin: number;
  maxSliceMs: number;
  statements: number;
  rows: number;
  hydrated: number;
  heapMB: number;
  returned: number;
  truncated: boolean;
  parity: boolean;
  ordered: boolean;
  pushdown: string;
  error?: string;
}

async function measure(
  src: Source,
  lib: number,
  plan: PlanName,
  q: ItemQuery,
  runs: number,
  chunk = CHUNK,
  hydrate: "set" | "perId" = "set",
) {
  const times: number[] = [],
    slices: number[] = [],
    heaps: number[] = [];
  let last;
  if (plan === "C-cold") dropSnapshots();
  for (let i = 0; i < runs + 1; i++) {
    if (plan === "C-cold") dropSnapshots();
    gc();
    const t = performance.now();
    last = await runPlan(plan, src, lib, q, { chunk, hydrate });
    const dt = performance.now() - t;
    if (i === 0 && runs > 0 && plan !== "REF") continue; // warmup (also builds the C-warm snapshot)
    times.push(dt);
    slices.push(last.meter.maxSliceMs);
    heaps.push(last.meter.peakHeap);
  }
  return {
    last: last!,
    ms: median(times),
    msMin: Math.min(...times),
    maxSliceMs: median(slices),
    heap: median(heaps),
  };
}

async function cancelProbe(
  src: Source,
  lib: number,
  plan: PlanName,
  q: ItemQuery,
  afterMs: number,
) {
  if (plan === "C-cold") dropSnapshots();
  const ac = new AbortController();
  let firedAt = 0;
  const scheduled = performance.now();
  setTimeout(() => {
    firedAt = performance.now();
    ac.abort();
  }, afterMs);
  try {
    await runPlan(plan, src, lib, q, {
      chunk: CHUNK,
      hydrate: "set",
      signal: ac.signal,
    });
    return {
      completedBeforeAbort: true,
      totalMs: r1(performance.now() - scheduled),
    };
  } catch (e) {
    if (!(e instanceof Cancelled)) throw e;
    const end = performance.now();
    return {
      completedBeforeAbort: false,
      timerLateMs: r1(firedAt - scheduled - afterMs),
      abortToRejectMs: r1(end - firedAt),
      totalMs: r1(end - scheduled),
    };
  }
}

// ------------------------------------------------------------------ main

async function main() {
  const fixtures = ensureFixtures(argv.has("--fresh"));
  const results: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    node: process.version,
    runs: RUNS,
    chunk: CHUNK,
    dbs: {},
  };
  const rows: Row[] = [];
  const firstRow: unknown[] = [];
  const sweeps: unknown[] = [],
    cancels: unknown[] = [],
    snapshotsMem: unknown[] = [],
    eqps: Record<string, unknown> = {};

  for (const fx of fixtures) {
    if (ONLY && fx.name !== ONLY) continue;
    const src = new Source(fx.path);
    const meta = src.db
      .prepare(
        `SELECT sqlite_version() AS sqlite, (SELECT version FROM version WHERE schema = 'userdata') AS userdata, (SELECT count(*) FROM sqlite_master WHERE name LIKE 'sqlite_stat%') AS statTables`,
      )
      .get() as Record<string, unknown>;
    const libs: [string, number][] = [["personal", src.libraryOf("user")!]];
    if (fx.kind === "scenario") libs.push(["group", src.libraryOf("group")!]);
    for (const [libName, lib] of libs) {
      const picks = fx.kind === "scenario" ? { counts: {} } : pick(src, lib);
      (results.dbs as any)[`${fx.name}/${libName}`] = {
        ...meta,
        kind: fx.kind,
        selectivity: picks.counts,
      };
      const cases =
        fx.kind === "scenario" ? scenarioSuite() : suite(picks as Picks);
      const plans =
        fx.name === "active-analyzed"
          ? (["REF", "A", "B", "H"] as PlanName[])
          : PLANS;
      for (const cs of cases) {
        process.stdout.write(`${fx.name}/${libName} ${cs.id} `);
        const ref = await measure(src, lib, "REF", cs.q, 0, CHUNK, "perId");
        const want = fingerprint(ref.last.result);
        for (const plan of plans) {
          const runs = fx.kind === "scenario" ? 0 : plan === "REF" ? 0 : RUNS;
          let row: Row;
          try {
            const m =
              plan === "REF" ? ref : await measure(src, lib, plan, cs.q, runs);
            const r = m.last;
            row = {
              db: fx.name,
              lib: libName,
              caseId: cs.id,
              plan,
              ms: r1(m.ms),
              msMin: r1(m.msMin),
              maxSliceMs: r1(m.maxSliceMs),
              statements: r.meter.statements,
              rows: r.meter.rows,
              hydrated: r.meter.hydrated,
              heapMB: mb(m.heap),
              returned: r.result.returnedCount,
              truncated: r.result.truncated,
              parity: fingerprint(r.result) === want,
              ordered: r.ordered,
              pushdown: r.pushdown,
            };
          } catch (e) {
            row = {
              db: fx.name,
              lib: libName,
              caseId: cs.id,
              plan,
              ms: Number.NaN,
              msMin: Number.NaN,
              maxSliceMs: Number.NaN,
              statements: 0,
              rows: 0,
              hydrated: 0,
              heapMB: 0,
              returned: 0,
              truncated: false,
              parity: false,
              ordered: false,
              pushdown: "",
              error: String(e),
            };
          }
          rows.push(row);
          process.stdout.write(
            `${plan}:${row.parity ? "✓" : "✗"}${Number.isNaN(row.ms) ? "" : row.ms} `,
          );
        }
        process.stdout.write("\n");
        if (fx.kind !== "scenario") {
          const u = universeSql(
            { ast: null, q: cs.q, evalNeeds: null!, projNeeds: null! } as never,
            false,
            src,
          );
          const pa = cs.q.filter ? lowerFor(src, cs.q) : null;
          eqps[`${fx.name}/${cs.id}`] = {
            A: pa
              ? src.eqp(pa.a.sql, [lib, ...pa.a.params])
              : src.eqp(u.sql, [lib]),
            Bleaves: pa?.leaves.map((l) => src.eqp(l.sql, l.params)) ?? [],
          };
        }
      }
      if (fx.kind === "scenario" || fx.name === "active-analyzed") continue;

      // first-row latency: SQLite sorts the whole Library inside the first step() of an ORDER BY scan
      for (const [label, sql] of [
        ["unordered", `SELECT ${BASE_COLS} ${UNIVERSE_FROM}`],
        [
          "default order",
          `SELECT ${BASE_COLS} ${UNIVERSE_FROM} ${DEFAULT_ORDER_SQL}`,
        ],
        ["key order", `SELECT ${BASE_COLS} ${UNIVERSE_FROM} ORDER BY i.key`],
      ] as const) {
        const ts: number[] = [];
        for (let i = 0; i < 5; i++) {
          const st = src.db.prepare(sql);
          const t = performance.now();
          st.iterate(lib).next();
          ts.push(performance.now() - t);
        }
        firstRow.push({ db: fx.name, scan: label, firstRowMs: r1(median(ts)) });
      }
      // chunk-size and per-ID crossover sweep on the hydrate-everything worst case
      const sweepCases = cases.filter((c) =>
        [
          "all.all",
          "tag.common.sort.title.all",
          "eq.type.dominant.all",
        ].includes(c.id),
      );
      for (const cs of sweepCases) {
        for (const [hydrate, chunk] of [
          ["perId", 250],
          ["set", 25],
          ["set", 100],
          ["set", 250],
          ["set", 1000],
          ["set", 4000],
        ] as const) {
          const m = await measure(
            src,
            lib,
            "A0k",
            cs.q,
            QUICK ? 1 : 3,
            chunk,
            hydrate,
          );
          sweeps.push({
            db: fx.name,
            caseId: cs.id,
            hydrate,
            chunk,
            ms: r1(m.ms),
            maxSliceMs: r1(m.maxSliceMs),
            statements: m.last.meter.statements,
            heapMB: mb(m.heap),
          });
          console.log(
            `  sweep ${fx.name} ${cs.id} ${hydrate}/${chunk}: ${r1(m.ms)}ms slice ${r1(m.maxSliceMs)}ms`,
          );
        }
      }
      // cancellation latency
      for (const cs of cases.filter((c) =>
        ["all.all", "sort.title.100"].includes(c.id),
      )) {
        for (const plan of [
          "A0",
          "A",
          "B",
          "A0k",
          "H",
          "C-cold",
        ] as PlanName[]) {
          cancels.push({
            db: fx.name,
            caseId: cs.id,
            plan,
            abortAfterMs: 20,
            ...(await cancelProbe(src, lib, plan, cs.q, 20)),
          });
        }
      }
      // retained snapshot size
      dropSnapshots();
      gc();
      const before = process.memoryUsage().heapUsed;
      await runPlan("C-warm", src, lib, cases[0]!.q, {
        chunk: CHUNK,
        hydrate: "set",
      });
      gc();
      snapshotsMem.push({
        db: fx.name,
        items: (results.dbs as any)[`${fx.name}/${libName}`].selectivity
          .universe,
        retainedMB: mb(process.memoryUsage().heapUsed - before),
      });
      dropSnapshots();
    }
    src.db.close();
  }

  Object.assign(results, {
    rows,
    firstRow,
    sweeps,
    cancels,
    snapshotsMem,
    eqps,
    finishedAt: new Date().toISOString(),
  });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
  writeFileSync(join(OUT, "RESULTS.md"), report(results as never));
  const bad = rows.filter((r) => !r.parity);
  console.log(`\nparity failures: ${bad.length}`);
  for (const b of bad)
    console.log(`  ${b.db}/${b.lib} ${b.caseId} ${b.plan} ${b.error ?? ""}`);
}

function lowerFor(src: Source, q: ItemQuery) {
  const ast = parse(q.filter!);
  const p = { q, ast, evalNeeds: null, projNeeds: null };
  const a = universeSql(p as never, true, src);
  const leaves: { sql: string; params: unknown[] }[] = [];
  const walk = (t: any): void => {
    if (t.k === "and" || t.k === "or") t.xs.forEach(walk);
    else if (t.k === "not") walk(t.x);
    else if (t.k !== "all") {
      const l = leafSql(t, 1);
      if (l) leaves.push(l);
    }
  };
  walk(lower(ast, src.schema).term);
  return { a, leaves };
}

// ------------------------------------------------------------------ report

function report(res: {
  rows: Row[];
  firstRow: any[];
  sweeps: any[];
  cancels: any[];
  snapshotsMem: any[];
  dbs: Record<string, any>;
  node: string;
  runs: number;
}): string {
  const L: string[] = [];
  L.push(
    `# Item Query plan prototype — measured results`,
    ``,
    `Generated by \`bench.ts\`. Node ${res.node}; median of ${res.runs} warm runs after one warmup (REF and scenario: one run). Chunk ${CHUNK} unless noted.`,
    ``,
  );
  L.push(
    `## Databases`,
    ``,
    `| db | kind | SQLite | userdata | sqlite_stat | universe | selectivity |`,
    `| --- | --- | --- | --- | --- | ---: | --- |`,
  );
  for (const [k, v] of Object.entries(res.dbs)) {
    const { universe, ...sel } = v.selectivity;
    L.push(
      `| ${k} | ${v.kind} | ${v.sqlite} | ${v.userdata} | ${v.statTables ? "yes" : "no"} | ${universe ?? "–"} | ${Object.entries(
        sel,
      )
        .map(([a, b]) => `${a}=${b}`)
        .join(", ")} |`,
    );
  }
  const bad = res.rows.filter((r) => !r.parity);
  L.push(
    ``,
    `## Parity`,
    ``,
    bad.length
      ? `**${bad.length} parity failures:**`
      : `All ${res.rows.length} plan runs match the REF oracle (rows, order, projected values, returnedCount, truncated).`,
  );
  for (const b of bad)
    L.push(`- ${b.db}/${b.lib} \`${b.caseId}\` ${b.plan} ${b.error ?? ""}`);
  const dbs = [
    ...new Set(res.rows.filter((r) => r.db !== "scenario").map((r) => r.db)),
  ];
  for (const db of dbs) {
    const rs = res.rows.filter((r) => r.db === db);
    const plans = [...new Set(rs.map((r) => r.plan))];
    const cases = [...new Set(rs.map((r) => r.caseId))];
    L.push(
      ``,
      `## ${db}: median ms (max synchronous slice ms)`,
      ``,
      `| case | ${plans.join(" | ")} | A pushdown | B pushdown |`,
      `| --- | ${plans.map(() => "---:").join(" | ")} | --- | --- |`,
    );
    for (const c of cases) {
      const by = (p: string) => rs.find((r) => r.caseId === c && r.plan === p);
      const cells = plans.map((p) => {
        const r = by(p)!;
        return r.error
          ? "err"
          : `${r.ms} (${r.maxSliceMs})${r.parity ? "" : " ✗"}`;
      });
      L.push(
        `| ${c} | ${cells.join(" | ")} | ${by("A")?.pushdown ?? ""} | ${by("B")?.pushdown ?? ""} |`,
      );
    }
    L.push(
      ``,
      `<details><summary>${db}: statements / rows read / Items hydrated / peak heap MB</summary>`,
      ``,
      `| case | ${plans.join(" | ")} |`,
      `| --- | ${plans.map(() => "---").join(" | ")} |`,
    );
    for (const c of cases) {
      L.push(
        `| ${c} | ${plans
          .map((p) => {
            const r = rs.find((x) => x.caseId === c && x.plan === p)!;
            return `${r.statements} / ${r.rows} / ${r.hydrated} / ${r.heapMB}`;
          })
          .join(" | ")} |`,
      );
    }
    L.push(``, `</details>`);
  }
  L.push(
    ``,
    `## Universe scan time-to-first-row (one synchronous step)`,
    ``,
    `| db | scan | first row ms |`,
    `| --- | --- | ---: |`,
  );
  for (const f of res.firstRow)
    L.push(`| ${f.db} | ${f.scan} | ${f.firstRowMs} |`);
  L.push(
    ``,
    `## Chunk size and per-ID crossover (plan A0k; projection always uses set loads)`,
    ``,
    `| db | case | hydrate | chunk | ms | max slice ms | statements | peak heap MB |`,
    `| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |`,
  );
  for (const s of res.sweeps)
    L.push(
      `| ${s.db} | ${s.caseId} | ${s.hydrate} | ${s.chunk} | ${s.ms} | ${s.maxSliceMs} | ${s.statements} | ${s.heapMB} |`,
    );
  L.push(
    ``,
    `## Cancellation (abort scheduled 20 ms after start)`,
    ``,
    `| db | case | plan | timer late ms | abort→reject ms | total ms |`,
    `| --- | --- | --- | ---: | ---: | ---: |`,
  );
  for (const c of res.cancels)
    L.push(
      `| ${c.db} | ${c.caseId} | ${c.plan} | ${c.completedBeforeAbort ? "finished first" : c.timerLateMs} | ${c.abortToRejectMs ?? "–"} | ${c.totalMs} |`,
    );
  L.push(
    ``,
    `## Retained snapshot heap (plan C)`,
    ``,
    `| db | Items | retained MB |`,
    `| --- | ---: | ---: |`,
  );
  for (const s of res.snapshotsMem)
    L.push(`| ${s.db} | ${s.items} | ${s.retainedMB} |`);
  L.push(
    ``,
    `EXPLAIN QUERY PLAN output for every A universe query and B leaf query is in \`results.json\` under \`eqps\`.`,
    ``,
  );
  return L.join("\n");
}

await main();
