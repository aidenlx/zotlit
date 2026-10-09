import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { validate } from "./check.mjs";

const oracle = JSON.parse(
  await readFile(new URL("./oracle.json", import.meta.url), "utf8"),
);
const root = "/evaluation-run";

function envelope(caseName) {
  const expected = oracle.cases[caseName];
  return {
    ok: true,
    identity: {
      source: { databasePath: join(root, "zotero-data", "zotero.sqlite") },
      vault: { path: join(root, "zt-fixture-vault") },
    },
    libraries: [{ type: "personal" }, { type: "group", groupID: 118 }],
    request: {
      limit: null,
      fields:
        caseName === "edge"
          ? ["title", "date.year", "creators"]
          : [
              "title",
              "date.year",
              "creators",
              'custom["review.status"]',
              "abstractNote",
            ],
    },
    truncated: false,
    returnedCount: expected.count,
    rows: expected.rows.map((row) => ({
      indexedKey: row.indexedKey,
      values: {
        title: row.title,
        "date.year": row.year,
        creators: [
          {
            fullName: row.firstCreator,
            role: row.firstCreator === row.firstAuthor ? "author" : "editor",
          },
          ...(row.firstCreator === row.firstAuthor
            ? []
            : row.firstAuthor
              ? [{ fullName: row.firstAuthor, role: "author" }]
              : []),
        ],
        'custom["review.status"]': row.status,
        abstractNote: "Evidence and method. ".repeat(550),
      },
    })),
  };
}

function annotationEnvelope(caseName) {
  const expected = oracle.cases[caseName];
  const keys = expected.keys;
  return {
    ok: true,
    identity: {
      source: { databasePath: join(root, "zotero-data", "zotero.sqlite") },
      vault: { path: join(root, "zt-fixture-vault") },
    },
    libraries: [{ type: "personal" }],
    request: {
      limit: null,
      fields:
        caseName === "position"
          ? ["text", "position", "attachment", "item.title"]
          : ["type", "tags", "hasExcerptImage", "attachment", "item.title"],
      filter:
        caseName === "mixed"
          ? 'type == "image" && tags.contains("figure") && item.citationKey == "rougierTenSimpleRules2014"'
          : null,
    },
    truncated: false,
    returnedCount: expected.count,
    rows: keys.map((indexedKey) => ({
      indexedKey,
      attachmentIndexedKey: "RGRPDF24",
      itemIndexedKey: "RUGIER24",
      values: {
        type: indexedKey === "FDRFQ7C2" ? "image" : "highlight",
        text: caseName === "position" ? expected.text : null,
        pageLabel: indexedKey === "FDRFQ7C2" ? "2" : "1",
        tags: indexedKey === "FDRFQ7C2" ? ["figure"] : [],
        hasExcerptImage: indexedKey === "FDRFQ7C2",
        attachment: {
          path: "/evaluation-run/attachments/rougier-2014.pdf",
          exists: true,
        },
        "item.title": "Ten Simple Rules for Better Figures",
        position: caseName === "position" ? expected.position : undefined,
      },
    })),
  };
}

await test("accepts the three complete oracle cases", () => {
  for (const name of ["include", "export", "edge"])
    assert.deepEqual(validate(name, envelope(name), { runRoot: root }), []);
});

await test("accepts the four complete Annotation Query cases", () => {
  for (const name of ["annotations", "mixed", "position", "image"])
    assert.deepEqual(
      validate(name, annotationEnvelope(name), { runRoot: root }),
      [],
    );
});

await test("rejects a split mixed filter and an omitted requested position", () => {
  const mixed = annotationEnvelope("mixed");
  mixed.request.filter = 'type == "image" && tags.contains("figure")';
  assert.match(
    validate("mixed", mixed, { runRoot: root }).join("\n"),
    /item\.citationKey/,
  );
  const position = annotationEnvelope("position");
  position.request.fields = ["text", "attachment"];
  assert.match(
    validate("position", position, { runRoot: root }).join("\n"),
    /position was not requested/,
  );
});

await test("rejects missing rows, truncated responses, and the wrong first author", () => {
  const missing = envelope("include");
  missing.rows.pop();
  assert.match(
    validate("include", missing, { runRoot: root }).join("\n"),
    /missing Indexed Key/,
  );

  const truncated = envelope("export");
  truncated.truncated = true;
  assert.match(
    validate("export", truncated, { runRoot: root }).join("\n"),
    /truncated/,
  );

  const wrongAuthor = envelope("edge");
  wrongAuthor.rows[0].values.creators[0].fullName = "Eve Editor";
  assert.match(
    validate("edge", wrongAuthor, { runRoot: root }).join("\n"),
    /wrong first author/,
  );
});
