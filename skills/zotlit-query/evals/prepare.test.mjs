import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { buildFixture, getFixtureLayout } from "@zotlit/scripts/fixture";

const repo = resolve(import.meta.dirname, "../../..");
const prepare = join(import.meta.dirname, "prepare.mjs");
const oracle = JSON.parse(
  await readFile(new URL("./oracle.json", import.meta.url), "utf8"),
);

await test("a generated Fixture stays unchanged and gives byte-identical seeded databases", async () => {
  const id = randomUUID();
  const source = join(repo, ".scratch", `item-query-test-source-${id}`);
  const first = join(repo, ".scratch", `item-query-test-first-${id}`);
  const second = join(repo, ".scratch", `item-query-test-second-${id}`);
  const database = (root) => join(root, "zotero-data", "zotero.sqlite");
  const digest = async (path) =>
    createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
  try {
    await buildFixture(getFixtureLayout(source));
    const original = await digest(database(source));
    for (const destination of [first, second])
      execFileSync(process.execPath, [prepare, source, destination], {
        cwd: repo,
      });
    assert.equal(await digest(database(source)), original);
    assert.equal(await digest(database(first)), await digest(database(second)));
    using db = new DatabaseSync(database(first), { readOnly: true });
    assert.equal(
      db.prepare("select count(*) as n from items where key like 'QEV%'").get()
        .n,
      125,
    );
    assert.equal(
      db
        .prepare(
          "select count(*) as n from items i where i.key like 'QEV%' and not exists (select 1 from itemData d join fieldsCombined f on f.fieldID = d.fieldID where d.itemID = i.itemID and f.fieldName = 'date')",
        )
        .get().n,
      13,
    );
    assert.equal(
      db
        .prepare(
          "select count(*) as n from items i join itemData d on d.itemID = i.itemID join fieldsCombined f on f.fieldID = d.fieldID join itemDataValues v on v.valueID = d.valueID where i.key like 'QEV%' and f.fieldName = 'review.status' and v.value = 'include'",
        )
        .get().n,
      42,
    );
    assert.ok(
      db
        .prepare(
          "select min(length(v.value)) as n from items i join itemData d on d.itemID = i.itemID join fieldsCombined f on f.fieldID = d.fieldID join itemDataValues v on v.valueID = d.valueID where i.key like 'QEV%' and f.fieldName = 'abstractNote'",
        )
        .get().n >
        10 * 1024,
    );
    assert.equal(
      db.prepare("select count(*) as n from items where key = 'EVALSAME'").get()
        .n,
      2,
    );
    const creators = db.prepare(
      "select c.firstName, c.lastName, ct.creatorType as role from items i join itemCreators ic on ic.itemID = i.itemID join creators c on c.creatorID = ic.creatorID join creatorTypes ct on ct.creatorTypeID = ic.creatorTypeID where i.key = ? and i.libraryID = ? order by ic.orderIndex",
    );
    for (const edge of oracle.cases.edge.rows) {
      const group = edge.indexedKey.endsWith("g118");
      const key = group ? edge.indexedKey.slice(0, -4) : edge.indexedKey;
      const people = creators.all(key, group ? 3 : 1);
      const firstAuthor = people.find((person) => person.role === "author");
      assert.equal(
        firstAuthor
          ? `${String(firstAuthor.firstName)} ${String(firstAuthor.lastName)}`
          : null,
        edge.firstAuthor,
      );
    }
    assert.equal(
      db
        .prepare(
          "select count(*) as n from itemTags it join tags t on t.tagID = it.tagID where t.name = 'query-eval-edge'",
        )
        .get().n,
      3,
    );
    const seededMarks = db
      .prepare(
        "select i.key, i.libraryID, a.text, a.comment, a.color, a.pageLabel, a.position from items i join itemAnnotations a on a.itemID = i.itemID where i.key like 'QAN%' order by i.key, i.libraryID",
      )
      .all();
    assert.equal(seededMarks.length, 5);
    assert.deepEqual(
      seededMarks
        .filter((row) => row.key === "QANMARK2")
        .map((row) => [
          row.libraryID,
          row.text,
          row.color,
          JSON.parse(row.position).rects[0],
        ]),
      [
        [
          1,
          "Identify Your Message",
          "#2ea8e5",
          [265.833, 611.202, 374.503, 620.019],
        ],
        [
          3,
          "Identify Your Message",
          "#2ea8e5",
          [265.833, 611.202, 374.503, 620.019],
        ],
      ],
    );
    assert.equal(
      await digest(
        join(first, "zotero-data", "storage", "QANPDF22", "rougier-2014.pdf"),
      ),
      await digest(
        join(source, "zt-fixture-vault", "attachments", "rougier-2014.pdf"),
      ),
    );
    assert.equal(
      db
        .prepare(
          "select count(*) as n from items i join itemTags it on it.itemID = i.itemID join tags t on t.tagID = it.tagID where t.name = 'query-annotation-eval'",
        )
        .get().n,
      3,
    );
    assert.equal(
      db
        .prepare(
          "select count(*) as n from items i join itemAnnotations a on a.itemID = i.itemID join itemTags it on it.itemID = i.itemID join tags t on t.tagID = it.tagID where t.name = 'query-annotation-method'",
        )
        .get().n,
      2,
    );
    assert.deepEqual(
      db
        .prepare(
          "select i.libraryID, a.path from items i join itemAttachments a on a.itemID = i.itemID where i.key = 'QANPDF22' order by i.libraryID",
        )
        .all()
        .map((row) => [row.libraryID, row.path]),
      [
        [1, "storage:rougier-2014.pdf"],
        [3, "storage:rougier-2014.pdf"],
      ],
    );
    assert.equal(
      db
        .prepare(
          "select count(*) as n from items p join items a on a.key = 'QANPDF22' and a.libraryID = p.libraryID join itemAttachments f on f.itemID = a.itemID and f.parentItemID = p.itemID where p.key = 'QANPAPER'",
        )
        .get().n,
      2,
    );
    assert.equal(
      db
        .prepare(
          "select count(*) as n from items i where i.key = 'QANZERO2' and not exists (select 1 from itemAttachments a where a.parentItemID = i.itemID)",
        )
        .get().n,
      1,
    );
    assert.equal(
      db
        .prepare(
          "select count(*) as n from items where key in ('QCPDFA22','QCPDFB22')",
        )
        .get().n,
      2,
    );
    assert.equal(
      db
        .prepare(
          "select count(*) as n from itemAnnotations a join items i on i.itemID=a.itemID where i.key like 'QC%'",
        )
        .get().n,
      3,
    );
    await assert.rejects(
      stat(
        join(
          first,
          "zotero-data",
          "storage",
          "MISSNG22",
          "deliberately-missing.pdf",
        ),
      ),
    );
    assert.throws(() =>
      execFileSync(
        process.execPath,
        [prepare, source, "/tmp/item-query-eval-forbidden"],
        { cwd: repo, stdio: "pipe" },
      ),
    );
  } finally {
    for (const path of [first, second, source])
      await rm(path, { recursive: true, force: true });
  }
});
