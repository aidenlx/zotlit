/**
 * PROTOTYPE — wipe me. Copies representative Zotero databases into
 * `.scratch/libraries/` and builds a 10× scaled Library from the active one.
 * Sources open with `immutable=1`; nothing writes to a Zotero-owned file.
 *
 *   node prepare-libraries.ts
 *   ZOTERO_DB=... LEGACY_DB=... node prepare-libraries.ts
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const here = import.meta.dirname;
const out = join(here, ".scratch/libraries");
mkdirSync(out, { recursive: true });

const sources: Record<string, string | undefined> = {
  active: process.env.ZOTERO_DB ?? join(homedir(), "Zotero/zotero.sqlite"),
  // The 24,352-Item legacy fixture from #597 is developer-local.
  legacy: process.env.LEGACY_DB,
};

for (const [name, src] of Object.entries(sources)) {
  const dest = join(out, `${name}.sqlite`);
  if (!src || !existsSync(src)) {
    console.warn(`skip ${name}: source not found (${src})`);
    continue;
  }
  rmSync(dest, { force: true });
  const url = pathToFileURL(src);
  url.searchParams.set("immutable", "1");
  const db = new DatabaseSync(url.href, { readOnly: true });
  db.exec(`VACUUM INTO '${dest.replaceAll("'", "''")}'`);
  db.close();
  console.log(`copied ${name} -> ${dest}`);
}

const SCALE = Number(process.env.SCALE ?? 10);
const base = join(out, "active.sqlite");
if (existsSync(base)) {
  const dest = join(out, `scaled-${SCALE}x.sqlite`);
  rmSync(dest, { force: true });
  const src = new DatabaseSync(base, { readOnly: true });
  src.exec(`VACUUM INTO '${dest}'`);
  src.close();

  const db = new DatabaseSync(dest);
  db.exec("PRAGMA foreign_keys = OFF; PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;");
  for (const { name } of db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
    .all() as { name: string }[]) {
    db.exec(`DROP TRIGGER "${name}"`);
  }
  const { maxID } = db.prepare("SELECT max(itemID) AS maxID FROM items").get() as {
    maxID: number;
  };
  const stride = maxID + 1;
  const cols = (table: string) =>
    (db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map(
      (c) => c.name,
    );
  /** Replicate a table, shifting the listed item-ID columns and rewriting `key`. */
  const replicate = (table: string, idCols: string[], rewriteKey = false) => {
    const c = cols(table);
    const select = c.map((col) =>
      idCols.includes(col)
        ? `"${col}" + :offset`
        : rewriteKey && col === "key"
          ? `'S' || printf('%07d', itemID + :offset)`
          : `"${col}"`,
    );
    return db.prepare(
      `INSERT INTO "${table}" (${c.map((x) => `"${x}"`).join(",")})
       SELECT ${select.join(",")} FROM "${table}" WHERE ${idCols[0]} < :stride`,
    );
  };
  const plans = [
    replicate("items", ["itemID"], true),
    replicate("itemData", ["itemID"]),
    replicate("itemCreators", ["itemID"]),
    replicate("itemTags", ["itemID"]),
    replicate("collectionItems", ["itemID"]),
    replicate("itemAttachments", ["itemID", "parentItemID"]),
    replicate("deletedItems", ["itemID"]),
  ];
  db.exec("BEGIN");
  for (let r = 1; r < SCALE; r++) {
    for (const p of plans) p.run({ offset: r * stride, stride });
  }
  db.exec("COMMIT");
  const { n } = db.prepare("SELECT count(*) AS n FROM items").get() as { n: number };
  db.close();
  console.log(`built scaled-${SCALE}x (${n} item rows) -> ${dest}`);
}
