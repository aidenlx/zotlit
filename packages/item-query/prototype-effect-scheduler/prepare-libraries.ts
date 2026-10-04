/**
 * PROTOTYPE — wipe me. Builds the three reference Library tiers of #596
 * (10,000 / 50,000 / 100,000 top-level Items in Library 1) in
 * `.scratch/libraries/` by repeating the active Zotero Library, with a partial
 * last copy to hit each tier exactly. The source opens with `immutable=1`;
 * nothing writes to a Zotero-owned file.
 *
 *   node prepare-libraries.ts            # ZOTERO_DB=... to choose the source
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const here = import.meta.dirname;
const out = join(here, ".scratch/libraries");
mkdirSync(out, { recursive: true });

const src = process.env.ZOTERO_DB ?? join(homedir(), "Zotero/zotero.sqlite");
if (!existsSync(src)) throw new Error(`source not found: ${src}`);
const base = join(out, "base.sqlite");
rmSync(base, { force: true });
const url = pathToFileURL(src);
url.searchParams.set("immutable", "1");
{
  const db = new DatabaseSync(url.href, { readOnly: true });
  db.exec(`VACUUM INTO '${base.replaceAll("'", "''")}'`);
  db.close();
}

const TOP_LEVEL = `SELECT i.itemID FROM items i JOIN itemTypes t USING (itemTypeID)
  WHERE i.libraryID = 1 AND t.typeName NOT IN ('attachment','note','annotation')
  AND i.itemID NOT IN (SELECT itemID FROM deletedItems)`;

const TIERS: Record<string, number> = {
  "tier-10k": 10_000,
  "tier-50k": 50_000,
  "tier-100k": 100_000,
};

for (const [name, target] of Object.entries(TIERS)) {
  const dest = join(out, `${name}.sqlite`);
  rmSync(dest, { force: true });
  {
    const db = new DatabaseSync(base, { readOnly: true });
    db.exec(`VACUUM INTO '${dest}'`);
    db.close();
  }
  const db = new DatabaseSync(dest);
  db.exec(
    "PRAGMA foreign_keys = OFF; PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;",
  );
  for (const { name: t } of db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
    .all() as { name: string }[]) {
    db.exec(`DROP TRIGGER "${t}"`);
  }
  const ids = (
    db.prepare(`${TOP_LEVEL} ORDER BY i.itemID`).all() as { itemID: number }[]
  ).map((r) => r.itemID);
  const per = ids.length;
  const { maxID } = db
    .prepare("SELECT max(itemID) AS maxID FROM items")
    .get() as { maxID: number };
  const stride = maxID + 1;
  const cols = (table: string) =>
    (
      db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]
    ).map((c) => c.name);
  /** Copy the rows whose first ID column is at most `:upto`, shifting ID columns and rewriting `key`. */
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
       SELECT ${select.join(",")} FROM "${table}" WHERE ${idCols[0]} <= :upto`,
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
  let have = per;
  for (let r = 1; have < target; r++) {
    const need = target - have;
    // A partial copy takes every row up to the itemID of the `need`-th top-level Item.
    const upto = need >= per ? maxID : ids[need - 1]!;
    for (const p of plans) p.run({ offset: r * stride, upto });
    have += Math.min(need, per);
  }
  db.exec("COMMIT");
  const { n } = db
    .prepare(`SELECT count(*) AS n FROM (${TOP_LEVEL})`)
    .get() as { n: number };
  db.close();
  console.log(`built ${name}: ${n} top-level Items (source ${per}) -> ${dest}`);
}
rmSync(base, { force: true });
