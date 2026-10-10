import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
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

function annotationEnvelope(caseName) {
  const expected = oracle.cases[caseName];
  const keys = expected.keys;
  return {
    ok: true,
    contractVersion: 3,
    command: "zotlit:query",
    warnings: [],
    identity: {
      source: { databasePath: join(root, "zotero-data", "zotero.sqlite") },
      vault: { path: join(root, "zt-fixture-vault") },
    },
    libraries: [{ type: "personal" }],
    request: {
      from: "annotations",
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
        type:
          expected.details?.[indexedKey]?.type ??
          (indexedKey === "FDRFQ7C2" ? "image" : "highlight"),
        text:
          caseName === "position"
            ? expected.text
            : (expected.details?.[indexedKey]?.text ?? null),
        comment: expected.details?.[indexedKey]?.comment ?? null,
        pageLabel:
          expected.details?.[indexedKey]?.pageLabel ??
          (indexedKey === "FDRFQ7C2" ? "2" : "1"),
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

function expandedEnvelope(caseName) {
  const expected = oracle.cases[caseName];
  const request = {
    from: "annotations",
    limit: null,
    fields: [
      "type",
      "pageLabel",
      "text",
      "comment",
      "library",
      "colorName",
      "tags",
      "pageIndex",
      "attachment",
    ],
    filter:
      caseName === "colors"
        ? 'item.indexedKey == "QANPAPER" && colorName == "blue" && tags.contains("query-annotation-method") && pageIndex == 0'
        : caseName === "missing_source"
          ? 'comment == "Check this source when the file arrives."'
          : caseName === "attachment" || caseName === "export_annotations"
            ? 'attachment.indexedKey == "QANPDF22g118"'
            : null,
    sort:
      caseName === "reverse_pages"
        ? [{ field: "pageIndex", direction: "desc" }]
        : [],
  };
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
    request,
    truncated: false,
    returnedCount: expected.count,
    rows: expected.keys
      .map((key) => oracle.annotationRows[key])
      .map((row) => ({
        indexedKey: row.key,
        itemIndexedKey: row.item,
        attachmentIndexedKey: row.attachment,
        values: {
          type: row.type,
          pageLabel: row.pageLabel,
          text: row.text,
          comment: row.comment,
          colorName: row.colorName,
          library: row.library,
          tags: row.tags,
          pageIndex: row.pageIndex,
          attachment: {
            path: join(
              root,
              "zotero-data",
              "storage",
              row.attachment.endsWith("g118")
                ? row.attachment.slice(0, -4)
                : row.attachment,
              basename(row.sourceSuffix),
            ),
            exists: row.sourceExists,
          },
        },
      })),
  };
}

function readingPlanItems() {
  const spec = oracle.cases.reading_plan;
  return {
    ok: true,
    contractVersion: 3,
    command: "zotlit:query",
    warnings: [],
    identity: {
      source: { databasePath: join(root, "zotero-data", "zotero.sqlite") },
      vault: { path: join(root, "zt-fixture-vault") },
    },
    request: { from: "items", fields: spec.fields, limit: null },
    truncated: false,
    returnedCount: 3,
    rows: structuredClone(spec.rows),
  };
}

await test("accepts the three complete oracle cases", () => {
  for (const name of ["include", "export", "edge"])
    assert.deepEqual(validate(name, envelope(name), { runRoot: root }), []);
});

await test("accepts eight expanded Annotation Query cases and rejects missing task evidence", () => {
  for (const name of [
    "reading_plan",
    "shared_marks",
    "attachment",
    "colors",
    "reverse_pages",
    "missing_source",
    "repair_filter",
    "export_annotations",
  ])
    assert.deepEqual(
      validate(
        name,
        name === "reading_plan" ? readingPlanItems() : expandedEnvelope(name),
        {
          runRoot: root,
        },
      ),
      [],
    );

  const wrongItem = readingPlanItems();
  wrongItem.rows.pop();
  assert.match(
    validate("reading_plan", wrongItem, { runRoot: root }).join("\n"),
    /missing/,
  );
  const noItems = readingPlanItems();
  delete noItems.rows;
  assert.match(
    validate("reading_plan", noItems, { runRoot: root }).join("\n"),
    /rows are missing/,
  );

  const shared = expandedEnvelope("shared_marks");
  shared.rows[1].itemIndexedKey = "QANPAPER";
  assert.match(
    validate("shared_marks", shared, { runRoot: root }).join("\n"),
    /wrong parent Item/,
  );

  const wrongScope = expandedEnvelope("colors");
  wrongScope.libraries = [{ type: "group", groupID: 118 }];
  assert.match(
    validate("colors", wrongScope, { runRoot: root }).join("\n"),
    /My Library was not queried/,
  );

  const missing = expandedEnvelope("missing_source");
  missing.rows[0].values.attachment.exists = true;
  assert.match(
    validate("missing_source", missing, { runRoot: root }).join("\n"),
    /wrong attachment\.exists/,
  );

  const reverse = expandedEnvelope("reverse_pages");
  reverse.rows.reverse();
  assert.match(
    validate("reverse_pages", reverse, { runRoot: root }).join("\n"),
    /wrong keys or order/,
  );
});

await test("accepts the four complete Annotation Query cases", () => {
  for (const name of ["annotations", "mixed", "position", "image"])
    assert.deepEqual(
      validate(name, annotationEnvelope(name), { runRoot: root }),
      [],
    );
});

await test("position object property order does not change its coordinates", () => {
  const position = annotationEnvelope("position");
  const { kind, pageIndex, rects } = position.rows[0].values.position;
  position.rows[0].values.position = { rects, pageIndex, kind };
  assert.deepEqual(validate("position", position, { runRoot: root }), []);
  position.rows[0].values.position.rects[0][0] += 1;
  assert.match(
    validate("position", position, { runRoot: root }).join("\n"),
    /wrong requested position/,
  );
});

await test("accepts live-style projected source paths and a filter-proven image type", () => {
  const annotations = annotationEnvelope("annotations");
  annotations.request.fields = [
    "type",
    "text",
    "comment",
    "pageLabel",
    "attachment.path",
    "item.citationKey",
  ];
  for (const row of annotations.rows) {
    row.values["attachment.path"] = row.values.attachment.path;
    delete row.values.attachment;
  }
  assert.deepEqual(validate("annotations", annotations, { runRoot: root }), []);
  annotations.rows[5].values.text = "The wrong quotation";
  assert.match(
    validate("annotations", annotations, { runRoot: root }).join("\n"),
    /PUPR5FG5 has wrong text/,
  );

  const mixed = annotationEnvelope("mixed");
  mixed.request.fields = ["item.title", "tags", "hasExcerptImage"];
  delete mixed.rows[0].values.type;
  assert.deepEqual(validate("mixed", mixed, { runRoot: root }), []);
  mixed.rows[0].values["item.title"] = "Wrong parent";
  assert.match(
    validate("mixed", mixed, { runRoot: root }).join("\n"),
    /wrong parent Item title/,
  );

  const image = annotationEnvelope("image");
  image.request.fields = ["hasExcerptImage"];
  image.rows[0].values = { hasExcerptImage: true };
  assert.deepEqual(validate("image", image, { runRoot: root }), []);
  image.rows[0].values.hasExcerptImage = false;
  assert.match(
    validate("image", image, { runRoot: root }).join("\n"),
    /Excerpt Image applicability/,
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
