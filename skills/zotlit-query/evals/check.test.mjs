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
    limit: null,
    fields: [
      "type",
      "pageLabel",
      "text",
      "comment",
      "colorName",
      "tags",
      "pageIndex",
      "attachment",
    ],
    filter:
      caseName === "colors"
        ? 'colorName == "blue" && tags.contains("query-annotation-method") && pageIndex == 0'
        : caseName === "missing_source"
          ? 'comment == "Check this source when the file arrives."'
          : null,
    item: caseName === "colors" ? ["QANPAPER"] : null,
    attachment:
      caseName === "attachment" || caseName === "export_annotations"
        ? ["QANPDF22g118"]
        : null,
    sort:
      caseName === "reverse_pages"
        ? [{ field: "pageIndex", direction: "desc" }]
        : [],
  };
  return {
    ok: true,
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
          tags: row.tags,
          pageIndex: row.pageIndex,
          attachment: {
            path: join(root, row.sourceSuffix),
            exists: row.sourceExists,
          },
        },
      })),
  };
}

function readingPlanItems() {
  const expected = oracle.cases.reading_plan;
  return {
    ok: true,
    identity: {
      source: { databasePath: join(root, "zotero-data", "zotero.sqlite") },
      vault: { path: join(root, "zt-fixture-vault") },
    },
    libraries: [{ type: "personal" }, { type: "group", groupID: 118 }],
    request: {
      limit: null,
      filter: 'tags.contains("query-annotation-eval")',
      fields: ["title"],
    },
    truncated: false,
    returnedCount: expected.items.length,
    rows: expected.items.map((item) => ({
      indexedKey: item.indexedKey,
      values: { title: item.title },
    })),
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
      validate(name, expandedEnvelope(name), {
        runRoot: root,
        itemEnvelope: name === "reading_plan" ? readingPlanItems() : undefined,
      }),
      [],
    );

  const noItems = expandedEnvelope("reading_plan");
  assert.match(
    validate("reading_plan", noItems, { runRoot: root }).join("\n"),
    /Item Query evidence is missing/,
  );
  const wrongItem = readingPlanItems();
  wrongItem.rows.pop();
  assert.match(
    validate("reading_plan", noItems, {
      runRoot: root,
      itemEnvelope: wrongItem,
    }).join("\n"),
    /Item Query has wrong papers/,
  );

  const shared = expandedEnvelope("shared_marks");
  shared.rows[1].itemIndexedKey = "QANPAPER";
  assert.match(
    validate("shared_marks", shared, { runRoot: root }).join("\n"),
    /wrong parent Item/,
  );

  const missing = expandedEnvelope("missing_source");
  missing.rows[0].values.attachment.exists = true;
  assert.match(
    validate("missing_source", missing, { runRoot: root }).join("\n"),
    /wrong source file/,
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
