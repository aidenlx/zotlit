import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import test from "node:test";

import { validate } from "./check.mjs";

const oracle = JSON.parse(
  await readFile(new URL("./oracle.json", import.meta.url), "utf8"),
);
const root = "/evaluation-run";

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

await test("accepts seven expanded Annotation Query cases and rejects missing task evidence", () => {
  for (const name of [
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
      }),
      [],
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
