// PROTOTYPE (#595) — throwaway. Builds scratch databases under the OS temp dir:
//   active          read-only copy of the user's live Zotero database (never written)
//   active-analyzed same copy + ANALYZE (sqlite_stat1/4) to test statistics sensitivity
//   synth-scalar    50k Items, scalar-heavy (long abstracts, sparse relations)
//   synth-relation  30k Items, relation-heavy (dense Tags/Collections/Attachments, creator outliers)
//   scenario        ~25 hand-made adversarial Items in a personal and a group Library
// Synthetic and scenario databases reuse the live database's DDL, so they carry Zotero's real indexes.
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const WORK = join(tmpdir(), "zotlit-item-query-prototype-WIPE-ME");
export const LIVE =
  process.env.ZOTLIT_PROTOTYPE_ZOTERO_DB ??
  join(homedir(), "Zotero", "zotero.sqlite");

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function zipf(r: () => number, n: number, s = 1.1) {
  const cum: number[] = [];
  let acc = 0;
  for (let i = 1; i <= n; i++) cum.push((acc += 1 / i ** s));
  return () => {
    const x = r() * acc;
    let lo = 0,
      hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid]! < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
}

const REFERENCE_TABLES = [
  "itemTypes",
  "itemTypesCombined",
  "fields",
  "fieldsCombined",
  "fieldFormats",
  "baseFieldMappings",
  "baseFieldMappingsCombined",
  "creatorTypes",
  "itemTypeFields",
  "itemTypeFieldsCombined",
  "itemTypeCreatorTypes",
  "version",
  "syncObjectTypes",
];

export class Writer {
  db: DatabaseSync;
  private readonly ids = { item: 0, value: 0, creator: 0, tag: 0, coll: 0 };
  private readonly values = new Map<unknown, number>();
  private readonly creators = new Map<string, number>();
  private readonly tags = new Map<string, number>();
  private readonly type = new Map<string, number>();
  private readonly field = new Map<string, number>();
  private readonly ctype = new Map<string, number>();
  private readonly s: Record<string, ReturnType<DatabaseSync["prepare"]>>;

  constructor(path: string, template: string) {
    rmSync(path, { force: true });
    this.db = new DatabaseSync(path);
    const tpl = new DatabaseSync(template, { readOnly: true });
    const ddl = tpl
      .prepare(
        `SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND type IN ('table','index') ORDER BY type = 'index'`,
      )
      .all() as any[];
    tpl.close();
    for (const d of ddl) this.db.exec(d.sql);
    this.db.exec(`ATTACH DATABASE '${template.replaceAll("'", "''")}' AS tpl`);
    for (const t of REFERENCE_TABLES) {
      try {
        this.db.exec(`INSERT INTO main.${t} SELECT * FROM tpl.${t}`);
      } catch {
        /* table absent in this schema version */
      }
    }
    this.db.exec(`DETACH DATABASE tpl`);
    for (const r of this.db
      .prepare(`SELECT itemTypeID, typeName FROM itemTypes`)
      .all() as any[])
      this.type.set(r.typeName, r.itemTypeID);
    for (const r of this.db
      .prepare(`SELECT fieldID, fieldName FROM fieldsCombined`)
      .all() as any[])
      this.field.set(r.fieldName, r.fieldID);
    for (const r of this.db
      .prepare(`SELECT creatorTypeID, creatorType FROM creatorTypes`)
      .all() as any[])
      this.ctype.set(r.creatorType, r.creatorTypeID);
    this.db.exec(
      `INSERT INTO libraries (libraryID, type, editable, filesEditable, version, storageVersion, lastSync) VALUES (1, 'user', 1, 1, 0, 0, 0)`,
    );
    this.s = {
      item: this.db.prepare(
        `INSERT INTO items (itemID, itemTypeID, dateAdded, dateModified, clientDateModified, libraryID, key) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ),
      value: this.db.prepare(
        `INSERT INTO itemDataValues (valueID, value) VALUES (?, ?)`,
      ),
      data: this.db.prepare(
        `INSERT INTO itemData (itemID, fieldID, valueID) VALUES (?, ?, ?)`,
      ),
      creator: this.db.prepare(
        `INSERT INTO creators (creatorID, firstName, lastName, fieldMode) VALUES (?, ?, ?, ?)`,
      ),
      itemCreator: this.db.prepare(
        `INSERT INTO itemCreators (itemID, creatorID, creatorTypeID, orderIndex) VALUES (?, ?, ?, ?)`,
      ),
      tag: this.db.prepare(`INSERT INTO tags (tagID, name) VALUES (?, ?)`),
      itemTag: this.db.prepare(
        `INSERT OR IGNORE INTO itemTags (itemID, tagID, type) VALUES (?, ?, ?)`,
      ),
      coll: this.db.prepare(
        `INSERT INTO collections (collectionID, collectionName, parentCollectionID, libraryID, key) VALUES (?, ?, ?, ?, ?)`,
      ),
      collItem: this.db.prepare(
        `INSERT OR IGNORE INTO collectionItems (collectionID, itemID, orderIndex) VALUES (?, ?, 0)`,
      ),
      att: this.db.prepare(
        `INSERT INTO itemAttachments (itemID, parentItemID, linkMode, contentType) VALUES (?, ?, 0, 'application/pdf')`,
      ),
      del: this.db.prepare(`INSERT INTO deletedItems (itemID) VALUES (?)`),
      delColl: this.db.prepare(
        `INSERT INTO deletedCollections (collectionID) VALUES (?)`,
      ),
    };
    this.db.exec("BEGIN");
  }

  group(libraryID: number, groupID: number) {
    this.db.exec(
      `INSERT INTO libraries (libraryID, type, editable, filesEditable, version, storageVersion, lastSync) VALUES (${libraryID}, 'group', 1, 1, 0, 0, 0)`,
    );
    this.db.exec(
      `INSERT INTO groups (groupID, libraryID, name, description, version) VALUES (${groupID}, ${libraryID}, 'Group', '', 0)`,
    );
  }

  collection(
    name: string,
    lib = 1,
    parent: number | null = null,
    deleted = false,
  ): number {
    const id = ++this.ids.coll;
    this.s.coll!.run(id, name, parent, lib, `C${String(id).padStart(7, "0")}`);
    if (deleted) this.s.delColl!.run(id);
    return id;
  }

  item(o: {
    type: string;
    key: string;
    lib?: number;
    dateModified: string;
    dateAdded?: string;
    fields?: Record<string, string | number>;
    creators?: [string, string, 0 | 1, string?][];
    tags?: (string | [string, number])[];
    colls?: number[];
    attachments?: { deleted?: boolean }[];
    deleted?: boolean;
    parent?: number;
  }): number {
    const id = ++this.ids.item;
    const lib = o.lib ?? 1;
    this.s.item!.run(
      id,
      this.type.get(o.type)!,
      o.dateAdded ?? o.dateModified,
      o.dateModified,
      o.dateModified,
      lib,
      o.key,
    );
    for (const [name, value] of Object.entries(o.fields ?? {})) {
      let vid = this.values.get(value);
      if (vid === undefined) {
        this.values.set(value, (vid = ++this.ids.value));
        this.s.value!.run(vid, value);
      }
      this.s.data!.run(id, this.field.get(name)!, vid);
    }
    (o.creators ?? []).forEach(([first, last, mode, role], i) => {
      const k = `${first}\u0000${last}\u0000${mode}`;
      let cid = this.creators.get(k);
      if (cid === undefined) {
        this.creators.set(k, (cid = ++this.ids.creator));
        this.s.creator!.run(cid, first, last, mode);
      }
      this.s.itemCreator!.run(id, cid, this.ctype.get(role ?? "author")!, i);
    });
    for (const t of o.tags ?? []) {
      const [name, type] = typeof t === "string" ? [t, 0] : t;
      let tid = this.tags.get(name);
      if (tid === undefined) {
        this.tags.set(name, (tid = ++this.ids.tag));
        this.s.tag!.run(tid, name);
      }
      this.s.itemTag!.run(id, tid, type);
    }
    for (const c of o.colls ?? []) this.s.collItem!.run(c, id);
    if (o.deleted) this.s.del!.run(id);
    (o.attachments ?? []).forEach((a) => {
      const aid = this.item({
        type: "attachment",
        key: `a${String(this.ids.item + 1).padStart(7, "0")}`,
        lib,
        dateModified: o.dateModified,
        deleted: a.deleted,
      });
      this.s.att!.run(aid, id);
    });
    return id;
  }

  done() {
    this.db.exec("COMMIT");
    this.db.close();
  }
}

// ------------------------------------------------------------------ synthetic

const VOCAB = (
  "the of and a in learning data model network analysis neural deep graph language system study " +
  "theory method evidence review protein cell climate policy quantum memory social market city history"
).split(" ");
const FIRST =
  "Ada Alan Grace Edsger Barbara Donald John Leslie Frances Ken Dennis Margaret Tim Radia Shafi".split(
    " ",
  );

function ts(r: () => number) {
  const d = new Date(
    Date.UTC(2014, 0, 1) + Math.floor(r() * 10 * 365 * 86400) * 1000,
  );
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export interface SynthSpec {
  n: number;
  seed: number;
  abstractRate: number;
  tagMean: number;
  tagPool: number;
  collCount: number;
  collMean: number;
  attMean: number;
  creatorMean: number;
  creatorOutlierRate: number;
  deletedRate: number;
}

export const SYNTH: Record<string, SynthSpec> = {
  "synth-scalar": {
    n: 50_000,
    seed: 1,
    abstractRate: 0.7,
    tagMean: 1.5,
    tagPool: 3000,
    collCount: 60,
    collMean: 0.05,
    attMean: 0.05,
    creatorMean: 3,
    creatorOutlierRate: 0.001,
    deletedRate: 0.005,
  },
  "synth-relation": {
    n: 30_000,
    seed: 2,
    abstractRate: 0,
    tagMean: 12,
    tagPool: 8000,
    collCount: 400,
    collMean: 2.5,
    attMean: 1.5,
    creatorMean: 6,
    creatorOutlierRate: 0.005,
    deletedRate: 0.02,
  },
};

function synth(path: string, template: string, spec: SynthSpec) {
  const w = new Writer(path, template);
  const r = rng(spec.seed);
  const types = [
    "journalArticle",
    "book",
    "bookSection",
    "conferencePaper",
    "thesis",
    "report",
    "webpage",
    "preprint",
  ];
  const typeWeights = [0.8, 0.06, 0.05, 0.04, 0.02, 0.015, 0.01, 0.005];
  const pickType = () => {
    let x = r();
    for (let i = 0; i < types.length; i++)
      if ((x -= typeWeights[i]!) < 0) return types[i]!;
    return types[0]!;
  };
  const date = zipf(r, 300),
    pub = zipf(r, 600),
    extra = zipf(r, 1500),
    tag = zipf(r, spec.tagPool, 1.0),
    name = zipf(r, 20000, 0.9);
  const colls: number[] = [];
  for (let i = 0; i < spec.collCount; i++) {
    // a shallow tree with repeated leaf names under different parents
    const parent =
      i > 10 && r() < 0.6 ? colls[Math.floor(r() * colls.length)]! : null;
    colls.push(
      w.collection(
        `Collection ${i % Math.max(1, Math.floor(spec.collCount * 0.8))}`,
        1,
        parent,
        r() < 0.01,
      ),
    );
  }
  const collPick = zipf(r, colls.length, 1.0);
  const poisson = (mean: number) => {
    let k = 0,
      p = Math.exp(-mean),
      s = p;
    const u = r();
    while (u > s && k < 500) {
      k++;
      p *= mean / k;
      s += p;
    }
    return k;
  };
  const keys = new Set<string>();
  const KEYCH = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";
  const bulk = Array.from({ length: 40 }, () => ts(r)); // bulk-import instants => dateModified ties
  for (let i = 0; i < spec.n; i++) {
    let key: string;
    do {
      key = Array.from(
        { length: 8 },
        () => KEYCH[Math.floor(r() * KEYCH.length)],
      ).join("");
    } while (keys.has(key));
    keys.add(key);
    const type = pickType();
    const words = Array.from(
      { length: 4 + Math.floor(r() * 8) },
      () => VOCAB[Math.floor(r() * VOCAB.length)]!,
    );
    const fields: Record<string, string> = {
      title: `${words.join(" ")} ${i}`,
      date: `${1990 + (date() % 34)}-${String(1 + (date() % 12)).padStart(2, "0")}-00 ${1990 + (date() % 34)}`,
    };
    const pubField =
      type === "bookSection"
        ? "bookTitle"
        : type === "conferencePaper"
          ? "proceedingsTitle"
          : type === "journalArticle"
            ? "publicationTitle"
            : null;
    if (pubField) fields[pubField] = `Venue ${pub()}`;
    if (r() < 0.3) fields.DOI = `10.${1000 + Math.floor(r() * 9000)}/${i}`;
    if (r() < 0.45) fields.extra = `note ${extra()}`;
    if (r() < 0.02)
      fields.language = ["en", "de", "fr", "zh", "ja"][Math.floor(r() * 5)]!;
    if (r() < spec.abstractRate)
      fields.abstractNote = Array.from(
        { length: 90 },
        () => VOCAB[Math.floor(r() * VOCAB.length)],
      ).join(" ");
    const nc =
      r() < spec.creatorOutlierRate
        ? 100 + Math.floor(r() * 200)
        : Math.max(1, poisson(spec.creatorMean));
    const creators = Array.from({ length: nc }, (_, j) => {
      const n = name();
      return n % 37 === 0
        ? [`Consortium ${n}`, "", 1, "author"]
        : [
            FIRST[n % FIRST.length]!,
            `Surname${n}`,
            0,
            j > 0 && r() < 0.1 ? "editor" : "author",
          ];
    }).map(([a, b, m, role]) =>
      m === 1 ? ["", a, 1, role] : [a, b, 0, role],
    ) as [string, string, 0 | 1, string][];
    const tags = Array.from({ length: poisson(spec.tagMean) }, () => {
      const t = tag();
      return [`tag-${t}`, t % 5 === 0 ? 1 : 0] as [string, number];
    });
    const itemColls = Array.from(
      { length: poisson(spec.collMean) },
      () => colls[collPick()]!,
    );
    const attachments = Array.from({ length: poisson(spec.attMean) }, () => ({
      deleted: r() < 0.05,
    }));
    w.item({
      type,
      key,
      dateModified: r() < 0.15 ? bulk[Math.floor(r() * bulk.length)]! : ts(r),
      fields,
      creators,
      tags,
      colls: itemColls,
      attachments,
      deleted: r() < spec.deletedRate,
    });
  }
  w.done();
}

// ------------------------------------------------------------------ scenario

export const SCENARIO_KEYS = { s1: "SCN00001" };

function scenario(path: string, template: string) {
  const w = new Writer(path, template);
  w.group(2, 9001);
  const T0 = "2024-01-01 00:00:00",
    T1 = "2024-02-01 00:00:00",
    T2 = "2024-03-01 00:00:00",
    T3 = "2023-12-01 00:00:00",
    T4 = "2023-06-01 00:00:00";
  const dupRoot = w.collection("Root");
  const dupA = w.collection("Dup", 1, dupRoot),
    dupB = w.collection("Dup");
  const gone = w.collection("Dup", 1, null, true); // trashed, same name as live ones
  const gDup = w.collection("Dup", 2);
  const ada: [string, string, 0, string] = ["Ada", "Lovelace", 0, "author"];
  w.item({
    type: "journalArticle",
    key: "SCN00001",
    dateModified: T0,
    fields: { title: "Tie A", publicationTitle: "Proc", volume: 12 },
    tags: ["Alpha", "alpha"],
    colls: [dupA],
    creators: [ada],
  });
  w.item({
    type: "journalArticle",
    key: "SCN00002",
    dateModified: T0,
    fields: { title: "Tie A", publicationTitle: "Proc" },
    tags: ["Alpha"],
  });
  w.item({
    type: "bookSection",
    key: "SCN00003",
    dateModified: T0,
    fields: { title: "100% Sure", bookTitle: "Proc" },
    colls: [dupA, dupB],
    creators: [ada, ["Ada", "Lovelace", 0, "editor"]],
  });
  w.item({
    type: "book",
    key: "SCN00004",
    dateModified: T1,
    fields: { title: "a_b back\\slash" },
    tags: ["Beta"],
    attachments: [{}],
  });
  w.item({
    type: "book",
    key: "SCN00005",
    dateModified: T1,
    fields: { title: "İstanbul Kelvin K" },
    attachments: [{ deleted: true }],
  });
  w.item({ type: "report", key: "SCN00006", dateModified: T2, colls: [gone] });
  w.item({
    type: "journalArticle",
    key: "SCN00007",
    dateModified: T2,
    fields: { title: "Trashed" },
    tags: ["Alpha", "Beta"],
    colls: [dupB],
    attachments: [{}],
    deleted: true,
  });
  w.item({ type: "note", key: "SCN00008", dateModified: T2 });
  w.item({ type: "attachment", key: "SCN00009", dateModified: T2 });
  w.item({
    type: "journalArticle",
    key: "SCN00010",
    dateModified: T3,
    fields: { title: "Tie A", volume: "12" },
    creators: [
      ["", "ACME", 1, "author"],
      ada,
      ["Ada", "Lovelace", 0, "editor"],
    ],
  });
  w.item({
    type: "conferencePaper",
    key: "SCN00011",
    dateModified: T3,
    fields: { title: "the Data", proceedingsTitle: "Proc" },
    tags: [["Alpha", 1]],
  });
  w.item({
    type: "journalArticle",
    key: "SCN00012",
    dateModified: T4,
    fields: { title: "B" },
    tags: ["Gamma"],
  });
  w.item({
    type: "journalArticle",
    key: "SCN00013",
    dateModified: T4,
    fields: { title: "b" },
  });
  w.item({ type: "journalArticle", key: "SCN00014", dateModified: T4 });
  w.item({
    type: "journalArticle",
    key: "SCN00015",
    dateModified: T4,
    fields: { title: "B" },
    attachments: [{}, { deleted: true }],
  });
  w.item({
    type: "thesis",
    key: "SCN00016",
    dateModified: T4,
    fields: { title: "Proc", extra: "Proc" },
  });
  // group Library: same keys as personal Items to prove Library isolation
  w.item({
    type: "journalArticle",
    key: "SCN00001",
    lib: 2,
    dateModified: T2,
    fields: { title: "Tie A", publicationTitle: "Proc" },
    tags: ["Alpha", "Beta"],
    colls: [gDup],
  });
  w.item({
    type: "book",
    key: "SCN00002",
    lib: 2,
    dateModified: T1,
    fields: { title: "100% Sure" },
    attachments: [{}],
  });
  w.item({
    type: "journalArticle",
    key: "SCN00003",
    lib: 2,
    dateModified: T1,
    fields: { title: "B" },
    tags: ["Gamma"],
    deleted: true,
  });
  w.done();
}

// ------------------------------------------------------------------ entry

export interface FixtureSet {
  name: string;
  path: string;
  kind: "real" | "synthetic" | "scenario";
}

export function ensureFixtures(fresh: boolean): FixtureSet[] {
  mkdirSync(WORK, { recursive: true });
  const active = join(WORK, "active.sqlite"),
    analyzed = join(WORK, "active-analyzed.sqlite");
  const out: FixtureSet[] = [];
  const stale = (p: string) => fresh || !existsSync(p);
  if (existsSync(LIVE)) {
    if (stale(active)) {
      copyFileSync(LIVE, active);
      const wal = `${LIVE}-wal`;
      if (existsSync(wal) && statSync(wal).size > 0)
        copyFileSync(wal, `${active}-wal`);
      rmSync(analyzed, { force: true });
    }
    if (!existsSync(analyzed)) {
      copyFileSync(active, analyzed);
      const db = new DatabaseSync(analyzed);
      db.exec("ANALYZE");
      db.close();
    }
    out.push(
      { name: "active", path: active, kind: "real" },
      { name: "active-analyzed", path: analyzed, kind: "real" },
    );
  } else {
    console.warn(
      `no live Zotero database at ${LIVE}; set ZOTLIT_PROTOTYPE_ZOTERO_DB. Real-Library runs skipped.`,
    );
  }
  const template = existsSync(active) ? active : LIVE;
  if (!existsSync(template))
    throw new Error("synthetic fixtures need a Zotero database for DDL");
  for (const [name, spec] of Object.entries(SYNTH)) {
    const p = join(WORK, `${name}.sqlite`);
    if (stale(p)) {
      console.log(`building ${name}…`);
      synth(p, template, spec);
    }
    out.push({ name, path: p, kind: "synthetic" });
  }
  const sc = join(WORK, "scenario.sqlite");
  if (stale(sc)) scenario(sc, template);
  out.push({ name: "scenario", path: sc, kind: "scenario" });
  return out;
}
