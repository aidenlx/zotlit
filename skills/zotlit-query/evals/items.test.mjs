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
    contractVersion: 3,
    command: "zotlit:query",
    warnings: [],
    identity: {
      source: { databasePath: join(root, "zotero-data", "zotero.sqlite") },
      vault: { path: join(root, "zt-fixture-vault") },
    },
    libraries: [{ type: "personal" }, { type: "group", groupID: 118 }],
    request: {
      from: "items",
      limit: null,
      fields:
        caseName === "edge"
          ? ["title", "date.year", "creators", "library"]
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
        library: row.indexedKey.endsWith("g118") ? "group:118" : "personal",
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

for (const caseName of ["include", "edge", "export"]) {
  for (const fields of [
    ["creators[]"],
    ["creators[].fullName", "creators[].role"],
  ]) {
    await test(`${caseName} accepts creator facts projected through ${fields.join(",")}`, () => {
      const result = envelope(caseName);
      result.request.fields = result.request.fields.flatMap((field) =>
        field === "creators" ? fields : [field],
      );
      for (const row of result.rows) {
        const creators = row.values.creators;
        delete row.values.creators;
        if (fields.length === 1) row.values["creators[]"] = creators;
        else {
          row.values["creators[].fullName"] = creators.map((c) => c.fullName);
          row.values["creators[].role"] = creators.map((c) => c.role);
        }
      }
      assert.deepEqual(validate(caseName, result, { runRoot: root }), []);
      if (fields.length === 1)
        result.rows[0].values["creators[]"][0].fullName = "Wrong creator";
      else result.rows[0].values["creators[].fullName"][0] = "Wrong creator";
      assert.match(
        validate(caseName, result, { runRoot: root }).join("\n"),
        /wrong first creator/,
      );
      if (fields.length === 2) {
        result.rows[0].values["creators[].role"].pop();
        assert.match(
          validate(caseName, result, { runRoot: root }).join("\n"),
          /missing creators/,
        );
      }
    });
  }
}

await test("edge accepts Library evidence from Indexed Keys", () => {
  const result = envelope("edge");
  result.request.fields = result.request.fields.filter((f) => f !== "library");
  for (const row of result.rows) delete row.values.library;
  assert.deepEqual(validate("edge", result, { runRoot: root }), []);
  result.rows[0].indexedKey += "g999";
  assert.ok(validate("edge", result, { runRoot: root }).length > 0);
});

for (const caseName of ["include", "edge", "export"]) {
  await test(`${caseName} accepts a complete grouped envelope and rejects a cut one`, () => {
    const result = envelope(caseName);
    const byYear = Map.groupBy(
      result.rows,
      (row) => row.values["date.year"] ?? null,
    );
    result.request.group = "date.year";
    result.groups = [...byYear].map(([value, rows]) => ({
      value,
      count: rows.length,
      rows,
    }));
    result.totalCount = result.rows.length;
    delete result.rows;
    assert.deepEqual(validate(caseName, result, { runRoot: root }), []);
    result.truncated = true;
    assert.match(
      validate(caseName, result, { runRoot: root }).join("\n"),
      /result is truncated/,
    );
  });
}
