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

await test("accepts the three complete oracle cases", () => {
  for (const name of ["include", "export", "edge"])
    assert.deepEqual(validate(name, envelope(name), { runRoot: root }), []);
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
