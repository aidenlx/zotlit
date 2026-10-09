#!/usr/bin/env node
// Copy a generated Fixture, then seed an isolated Item Query evaluation corpus.
import { cp, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const scratch = join(repo, ".scratch");
const [sourceArg, destinationArg] = process.argv.slice(2);

function fail(message) {
  throw new Error(message);
}
function inside(parent, child) {
  const rel = relative(parent, child);
  return (
    rel !== "" &&
    rel !== ".." &&
    !rel.startsWith(`..${sep}`) &&
    !isAbsolute(rel)
  );
}
async function safePath(path, mustExist) {
  if (!isAbsolute(path) || !inside(scratch, path))
    fail(`path must be absolute and inside ${scratch}: ${path}`);
  let current = scratch;
  for (const part of relative(scratch, path).split(sep)) {
    current = join(current, part);
    const info = await lstat(current).catch((error) =>
      error.code === "ENOENT" ? null : Promise.reject(error),
    );
    if (info?.isSymbolicLink())
      fail(`symbolic link is not allowed: ${current}`);
    if (!info && mustExist) fail(`missing path: ${current}`);
  }
}
function lookup(db, sql, name) {
  const row = db.prepare(sql).get(name);
  if (!row) fail(`Fixture schema is missing ${name}`);
  return row.id;
}
function keyAt(i) {
  // Zotero excludes 0 and 1 from its eight-character object keys.
  let n = i;
  let suffix = "";
  for (let digit = 0; digit < 5; digit++) {
    suffix = String((n % 8) + 2) + suffix;
    n = Math.floor(n / 8);
  }
  return `QEV${suffix}`;
}

function seed(db) {
  const type = (name) =>
    lookup(
      db,
      "select itemTypeID as id from itemTypesCombined where typeName = ?",
      name,
    );
  const field = (name) =>
    lookup(
      db,
      "select fieldID as id from fieldsCombined where fieldName = ? and custom = 0",
      name,
    );
  const role = (name) =>
    lookup(
      db,
      "select creatorTypeID as id from creatorTypes where creatorType = ?",
      name,
    );
  const article = type("journalArticle"),
    book = type("book");
  const title = field("title"),
    date = field("date"),
    abstract = field("abstractNote");
  const author = role("author"),
    editor = role("editor");
  const customField = "review.status";
  if (
    db
      .prepare("select 1 from fieldsCombined where fieldName = ?")
      .get(customField)
  )
    fail("source already has review.status");
  if (
    db
      .prepare(
        "select 1 from tags where name in ('query-eval', 'query-eval-edge')",
      )
      .get()
  )
    fail("source already has evaluation tags");
  for (const key of [keyAt(0), "EVALSAME", "EVALED33"]) {
    if (db.prepare("select 1 from items where key = ?").get(key))
      fail(`source already has ${key}`);
  }
  db.exec("begin");
  try {
    const customID =
      Number(
        db
          .prepare("insert into customFields (fieldName, label) values (?, ?)")
          .run(customField, customField).lastInsertRowid,
      ) + 10_000;
    db.prepare(
      "insert into fieldsCombined (fieldID, fieldName, label, fieldFormatID, custom) values (?, ?, ?, null, 1)",
    ).run(customID, customField, customField);
    const tagID = Number(
      db.prepare("insert into tags (name) values ('query-eval')").run()
        .lastInsertRowid,
    );
    const edgeTagID = Number(
      db.prepare("insert into tags (name) values ('query-eval-edge')").run()
        .lastInsertRowid,
    );
    const addItem = db.prepare(
      "insert into items (itemTypeID, dateAdded, dateModified, clientDateModified, libraryID, key) values (?, ?, ?, ?, ?, ?)",
    );
    const addValue = db.prepare(
      "insert into itemDataValues (value) values (?)",
    );
    const addData = db.prepare(
      "insert into itemData (itemID, fieldID, valueID) values (?, ?, ?)",
    );
    const addCreator = db.prepare(
      "insert into creators (firstName, lastName, fieldMode) values (?, ?, 0)",
    );
    const addItemCreator = db.prepare(
      "insert into itemCreators (itemID, creatorID, creatorTypeID, orderIndex) values (?, ?, ?, ?)",
    );
    const addTag = db.prepare(
      "insert into itemTags (itemID, tagID, type) values (?, ?, 0)",
    );
    const values = new Map();
    function put(itemID, fieldID, value) {
      let valueID = values.get(value);
      if (!valueID) {
        valueID = db
          .prepare("select valueID from itemDataValues where value = ?")
          .get(value)?.valueID;
        valueID ??= Number(addValue.run(value).lastInsertRowid);
        values.set(value, valueID);
      }
      addData.run(itemID, fieldID, valueID);
    }
    function creator(itemID, { firstName, lastName, typeID, index }) {
      const existing = db
        .prepare(
          "select creatorID from creators where firstName = ? and lastName = ? and fieldMode = 0",
        )
        .get(firstName, lastName);
      const id =
        existing?.creatorID ??
        Number(addCreator.run(firstName, lastName).lastInsertRowid);
      addItemCreator.run(itemID, id, typeID, index);
    }
    const stamp = "2024-01-02 03:04:05";
    for (let i = 0; i < 125; i++) {
      const itemID = Number(
        addItem.run(article, stamp, stamp, stamp, i < 100 ? 1 : 3, keyAt(i))
          .lastInsertRowid,
      );
      put(
        itemID,
        title,
        `Query evaluation article ${String(i).padStart(3, "0")}`,
      );
      if (i % 10 !== 0) put(itemID, date, String(2020 + (i % 5)));
      put(
        itemID,
        abstract,
        `Evaluation abstract ${String(i).padStart(3, "0")}. ${"Evidence and method. ".repeat(550)}`,
      );
      put(itemID, customID, ["include", "exclude", "pending"][i % 3]);
      creator(itemID, {
        firstName: "Eve",
        lastName: `Editor${String(i).padStart(3, "0")}`,
        typeID: editor,
        index: 0,
      });
      creator(itemID, {
        firstName: "Ada",
        lastName: `Author${String(i).padStart(3, "0")}`,
        typeID: author,
        index: 1,
      });
      addTag.run(itemID, tagID);
    }
    const edges = [
      {
        key: "EVALSAME",
        libraryID: 1,
        title: "Shared key in My Library",
        year: "2024",
        author: "Personal",
      },
      {
        key: "EVALSAME",
        libraryID: 3,
        title: "Shared key in Lab Archive",
        year: null,
        author: "Lab",
      },
      {
        key: "EVALED33",
        libraryID: 1,
        title: "Edited handbook without an author",
        year: "2023",
        author: null,
      },
    ];
    for (const edge of edges) {
      const itemID = Number(
        addItem.run(book, stamp, stamp, stamp, edge.libraryID, edge.key)
          .lastInsertRowid,
      );
      put(itemID, title, edge.title);
      if (edge.year) put(itemID, date, edge.year);
      creator(itemID, {
        firstName: edge.author ? "Ada" : "Eve",
        lastName: edge.author ?? "Handbook Editor",
        typeID: edge.author ? author : editor,
        index: 0,
      });
      addTag.run(itemID, edgeTagID);
    }
    db.exec("commit");
  } catch (error) {
    db.exec("rollback");
    throw error;
  }
}

async function main() {
  if (!sourceArg || !destinationArg)
    fail(
      "usage: node prepare.mjs <absolute-generated-Fixture-root> <absolute-new-run-root-under-.scratch>",
    );
  const source = resolve(sourceArg),
    destination = resolve(destinationArg);
  await safePath(source, true);
  await safePath(destination, false);
  if (
    inside(source, destination) ||
    inside(destination, source) ||
    source === destination
  )
    fail("source and destination must be separate trees");
  const database = join(source, "zotero-data", "zotero.sqlite");
  const prefs = join(source, "zotero-profile", "prefs.js");
  const vault = join(source, "zt-fixture-vault");
  for (const path of [database, prefs, vault]) await safePath(path, true);
  if (await lstat(destination).catch(() => null))
    fail(`destination already exists: ${destination}`);
  const sourceDb = new DatabaseSync(database, { readOnly: true });
  try {
    if (
      sourceDb.prepare("pragma integrity_check").get().integrity_check !== "ok"
    )
      fail("source Fixture database failed integrity_check");
  } finally {
    sourceDb.close();
  }
  const prefsText = await readFile(prefs, "utf8");
  const oldLine = `user_pref("extensions.zotero.dataDir", ${JSON.stringify(join(source, "zotero-data"))});`;
  if (!prefsText.includes(oldLine))
    fail("source profile does not point at the source Fixture database");
  await cp(source, destination, {
    recursive: true,
    force: false,
    errorOnExist: true,
    filter: async (path) => {
      const info = await lstat(path);
      if (info.isSymbolicLink())
        fail(`source contains a symbolic link: ${path}`);
      return true;
    },
  });
  const copiedPrefs = join(destination, "zotero-profile", "prefs.js");
  await writeFile(
    copiedPrefs,
    prefsText.replace(
      oldLine,
      `user_pref("extensions.zotero.dataDir", ${JSON.stringify(join(destination, "zotero-data"))});`,
    ),
  );
  const copiedDb = new DatabaseSync(
    join(destination, "zotero-data", "zotero.sqlite"),
  );
  try {
    seed(copiedDb);
    if (
      copiedDb.prepare("pragma integrity_check").get().integrity_check !== "ok"
    )
      fail("seeded database failed integrity_check");
    if (copiedDb.prepare("pragma foreign_key_check").get())
      fail("seeded database failed foreign_key_check");
  } finally {
    copiedDb.close();
  }
  await mkdir(join(destination, "results"));
  console.log(
    JSON.stringify(
      {
        runRoot: destination,
        database: join(destination, "zotero-data", "zotero.sqlite"),
        vault: join(destination, "zt-fixture-vault"),
        profile: join(destination, "zotero-profile"),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
