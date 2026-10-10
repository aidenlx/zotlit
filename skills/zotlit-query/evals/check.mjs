#!/usr/bin/env node
// Check a saved ZotLit Query envelope against the committed evaluation oracle.
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { checkResearch, researchExpectation } from "./research.mjs";
import { resultRows } from "./result-rows.mjs";

const oracle = JSON.parse(
  await readFile(new URL("./oracle.json", import.meta.url), "utf8"),
);
const itemFields = {
  include: ["title", "date.year"],
  export: ["title", "date.year", 'custom["review.status"]', "abstractNote"],
  edge: ["title", "date.year"],
};
const expandedAnnotationCases = new Set([
  "shared_marks",
  "attachment",
  "colors",
  "reverse_pages",
  "missing_source",
  "repair_filter",
  "export_annotations",
]);
const expandedFields = {
  // Indexed Keys identify the Library; the answer checker verifies its name.
  shared_marks: ["text", "colorName"],
  attachment: ["type", "pageLabel", "text", "comment", "attachment.path"],
  colors: ["text", "colorName", "tags", "pageIndex"],
  reverse_pages: ["type", "pageLabel", "pageIndex", "text"],
  missing_source: ["comment", "attachment.path", "attachment.exists"],
  repair_filter: ["text", "colorName"],
  export_annotations: [
    "type",
    "pageLabel",
    "text",
    "comment",
    "attachment.path",
  ],
};

function sourcePath(values) {
  return values?.attachment?.path ?? values?.["attachment.path"] ?? null;
}

function sourceExists(values) {
  return values?.attachment?.exists ?? values?.["attachment.exists"];
}

function projected(fields, field) {
  return (
    fields?.includes(field) ||
    (field.startsWith("attachment.") && fields?.includes("attachment"))
  );
}

function commonChecks(envelope, expected, { runRoot, vaultPath }) {
  const errors = [];
  const need = (test, message) => {
    if (!test) errors.push(message);
  };
  need(envelope?.ok === true, "query response is not successful");
  need(
    envelope?.contractVersion === 3 && envelope?.command === "zotlit:query",
    "wrong Query contract",
  );
  need(envelope?.request?.from === expected.from, "wrong Query Dataset");
  need(Array.isArray(envelope?.warnings), "Query Warnings are missing");
  need(
    envelope?.identity?.source?.databasePath ===
      join(runRoot, "zotero-data", "zotero.sqlite"),
    "wrong source database",
  );
  need(envelope?.identity?.vault?.path === vaultPath, "wrong evaluation vault");
  if (expected.groups) {
    const returned = (envelope.groups ?? []).reduce(
      (count, group) => count + (group.rows?.length ?? 0),
      0,
    );
    need(envelope.returnedCount === returned, "wrong returnedCount");
    // Element groups overlap, so truncation is a cut group, not fewer rows
    // than records.
    need(
      envelope.truncated ===
        (envelope.groups ?? []).some(
          (group) => (group.rows?.length ?? 0) < group.count,
        ),
      "wrong grouped truncation",
    );
    const limit = envelope.request?.limit;
    need(
      limit === null || (Number.isInteger(limit) && limit > 0),
      "invalid group limit",
    );
  } else {
    need(envelope?.request?.limit === null, "limit must be all");
    need(envelope?.truncated === false, "result is truncated");
    need(
      envelope?.returnedCount === expected.count,
      `expected ${expected.count} returned rows`,
    );
  }
  return { errors, need };
}

function validateExpandedAnnotations(
  caseName,
  envelope,
  { expected, ...context },
) {
  const { errors, need } = commonChecks(envelope, expected, context);
  const request = envelope?.request ?? {};
  for (const field of expandedFields[caseName])
    need(projected(request.fields, field), `missing projected field ${field}`);
  const rows = resultRows(envelope);
  need(Array.isArray(rows), "full result rows are missing");
  if (!Array.isArray(rows)) return errors;
  need(rows.length === expected.count, `expected ${expected.count} rows`);
  const actualKeys = rows.map((row) => row.indexedKey);
  const desiredKeys = expected.keys;
  need(
    JSON.stringify(
      ["reverse_pages", "attachment", "export_annotations"].includes(caseName)
        ? actualKeys
        : [...actualKeys].sort((a, b) => a.localeCompare(b)),
    ) ===
      JSON.stringify(
        ["reverse_pages", "attachment", "export_annotations"].includes(caseName)
          ? desiredKeys
          : [...desiredKeys].sort((a, b) => a.localeCompare(b)),
      ),
    "Annotation Rows have wrong keys or order",
  );
  const byKey = new Map(rows.map((row) => [row.indexedKey, row]));
  need(byKey.size === rows.length, "duplicate Annotation Indexed Key");
  for (const key of expected.keys) {
    const spec = oracle.annotationRows[key];
    const row = byKey.get(spec.key);
    if (!row) continue;
    need(row.itemIndexedKey === spec.item, `${spec.key} has wrong parent Item`);
    need(
      row.attachmentIndexedKey === spec.attachment,
      `${spec.key} has wrong parent Attachment`,
    );
    const values = row.values ?? {};
    for (const field of expandedFields[caseName]) {
      if (field.startsWith("attachment.")) continue;
      need(
        isDeepStrictEqual(values[field] ?? null, spec[field] ?? null),
        `${spec.key} has wrong ${field}`,
      );
    }
    if (expandedFields[caseName].includes("attachment.path")) {
      const attachmentKey = spec.attachment.endsWith("g118")
        ? spec.attachment.slice(0, -4)
        : spec.attachment;
      need(
        sourcePath(values) ===
          join(
            context.runRoot,
            "zotero-data",
            "storage",
            attachmentKey,
            basename(spec.sourceSuffix),
          ),
        `${spec.key} has wrong source file`,
      );
    }
    if (expandedFields[caseName].includes("attachment.exists"))
      need(
        sourceExists(values) === spec.sourceExists,
        `${spec.key} has wrong attachment.exists`,
      );
  }
  if (expected.keys.some((key) => !key.endsWith("g118"))) {
    need(
      envelope?.libraries?.some((library) => library.type === "personal"),
      "My Library was not queried",
    );
  }
  if (expected.keys.some((key) => key.endsWith("g118"))) {
    need(
      envelope?.libraries?.some((library) => library.groupID === 118),
      "Lab Archive was not queried",
    );
  }
  return errors;
}

function validateAnnotations(caseName, envelope, { expected, ...context }) {
  const { errors, need } = commonChecks(envelope, expected, context);
  need(
    envelope?.libraries?.some((library) => library.type === "personal"),
    "My Library was not queried",
  );
  const rows = resultRows(envelope);
  need(Array.isArray(rows), "full result rows are missing");
  if (!Array.isArray(rows)) return errors;
  need(rows.length === expected.count, `expected ${expected.count} rows`);
  need(
    JSON.stringify(rows.map((row) => row.indexedKey)) ===
      JSON.stringify(expected.keys),
    "Annotation Rows have wrong keys or reading order",
  );
  for (const row of rows) {
    need(
      row.itemIndexedKey === "RUGIER24",
      `${row.indexedKey} has wrong parent Item`,
    );
    need(
      row.attachmentIndexedKey === "RGRPDF24",
      `${row.indexedKey} has wrong parent Attachment`,
    );
  }
  if (caseName === "annotations") {
    for (const row of rows) {
      need(
        typeof row.values?.type === "string",
        `${row.indexedKey} has no type`,
      );
      need(
        typeof row.values?.pageLabel === "string",
        `${row.indexedKey} has no page label`,
      );
      need(
        sourcePath(row.values)?.endsWith("attachments/rougier-2014.pdf"),
        `${row.indexedKey} has no source path`,
      );
      const detail = expected.details?.[row.indexedKey];
      if (detail)
        for (const field of ["type", "pageLabel", "text", "comment"])
          need(
            (row.values?.[field] ?? null) === detail[field],
            `${row.indexedKey} has wrong ${field}`,
          );
    }
  }
  if (caseName === "mixed" || caseName === "image") {
    const row = rows[0];
    if (caseName === "mixed")
      need(
        isDeepStrictEqual(row?.values?.tags, expected.tags),
        "wrong Annotation Tags",
      );
    need(
      row?.values?.hasExcerptImage === expected.hasExcerptImage,
      "wrong Excerpt Image applicability",
    );
    if (caseName === "mixed")
      need(
        row?.values?.["item.title"] === expected.itemTitle,
        "wrong parent Item title",
      );
    if (caseName === "mixed")
      for (const fragment of ["type", "tags", "item.citationKey"])
        need(
          envelope?.request?.filter?.includes(fragment),
          `mixed filter does not contain ${fragment}`,
        );
  }
  if (caseName === "position") {
    const row = rows[0];
    need(
      envelope?.request?.fields?.includes("position"),
      "position was not requested",
    );
    need(row?.values?.text === expected.text, "wrong quoted text");
    need(
      isDeepStrictEqual(row?.values?.position, expected.position),
      "wrong requested position",
    );
    need(
      sourcePath(row?.values)?.endsWith("attachments/rougier-2014.pdf"),
      "position row has no source path",
    );
  }
  return errors;
}

function projectedCreators(values) {
  const creators = values.creators ?? values["creators[]"];
  if (Array.isArray(creators)) return creators;
  const names = values["creators[].fullName"];
  const roles = values["creators[].role"];
  if (
    !Array.isArray(names) ||
    !Array.isArray(roles) ||
    names.length !== roles.length
  )
    return null;
  return names.map((fullName, index) => ({ fullName, role: roles[index] }));
}

function validateItems(caseName, envelope, { expected, ...context }) {
  const { errors, need } = commonChecks(envelope, expected, context);
  for (const field of itemFields[caseName])
    need(
      envelope?.request?.fields?.includes(field),
      `missing projected field ${field}`,
    );
  need(
    envelope?.libraries?.some((library) => library.type === "personal"),
    "My Library was not queried",
  );
  need(
    envelope?.libraries?.some((library) => library.groupID === 118),
    "Lab Archive was not queried",
  );
  const rows = resultRows(envelope);
  need(Array.isArray(rows), "full result rows are missing");
  if (!Array.isArray(rows)) return errors;
  need(rows.length === expected.count, `expected ${expected.count} rows`);
  const byKey = new Map();
  for (const row of rows) {
    if (byKey.has(row.indexedKey))
      errors.push(`duplicate Indexed Key ${row.indexedKey}`);
    byKey.set(row.indexedKey, row);
  }
  const expectedKeys = new Set(expected.rows.map((row) => row.indexedKey));
  for (const key of byKey.keys())
    need(expectedKeys.has(key), `unexpected Indexed Key ${key}`);
  let missingYear = 0;
  for (const item of expected.rows) {
    const row = byKey.get(item.indexedKey);
    if (!row) {
      errors.push(`missing Indexed Key ${item.indexedKey}`);
      continue;
    }
    const values = row.values ?? {};
    need(values.title === item.title, `wrong title for ${item.indexedKey}`);
    need(
      values["date.year"] === item.year,
      `wrong publication year for ${item.indexedKey}`,
    );
    if (values["date.year"] === null) missingYear++;
    const creators = projectedCreators(values);
    need(Array.isArray(creators), `missing creators for ${item.indexedKey}`);
    if (Array.isArray(creators)) {
      need(
        creators[0]?.fullName === item.firstCreator,
        `wrong first creator for ${item.indexedKey}`,
      );
      const firstAuthor =
        creators.find((creator) => creator.role === "author")?.fullName ?? null;
      need(
        firstAuthor === item.firstAuthor,
        `wrong first author for ${item.indexedKey}`,
      );
    }
    if (caseName === "export")
      need(
        values['custom["review.status"]'] === item.status,
        `wrong review status for ${item.indexedKey}`,
      );
    if (caseName === "export")
      need(
        typeof values.abstractNote === "string" &&
          Buffer.byteLength(values.abstractNote) > 10 * 1024,
        `missing long abstract for ${item.indexedKey}`,
      );
  }
  if (expected.missingYear !== undefined)
    need(
      missingYear === expected.missingYear,
      `expected ${expected.missingYear} missing publication years`,
    );
  return errors;
}

export function validate(
  caseName,
  envelope,
  { runRoot, vaultPath = join(runRoot, "zt-fixture-vault") },
) {
  const entry = oracle.cases[caseName];
  const expected =
    entry &&
    researchExpectation(
      {
        ...entry,
        from:
          entry.from ??
          (Object.hasOwn(itemFields, caseName) ? "items" : "annotations"),
      },
      envelope,
    );
  if (!expected) throw new Error(`unknown case: ${caseName}`);
  const context = { expected, runRoot, vaultPath };
  if (expected.kind === "research")
    return [
      ...commonChecks(envelope, expected, context).errors,
      ...checkResearch(expected, envelope, runRoot),
    ];
  return Object.hasOwn(itemFields, caseName)
    ? validateItems(caseName, envelope, context)
    : expandedAnnotationCases.has(caseName)
      ? validateExpandedAnnotations(caseName, envelope, context)
      : validateAnnotations(caseName, envelope, context);
}

async function main() {
  const [caseName, resultArg, runRootArg] = process.argv.slice(2);
  if (!caseName || !resultArg || !runRootArg)
    throw new Error(
      "usage: node check.mjs <case> <full-envelope.json> <absolute-run-root>",
    );
  const runRoot = resolve(runRootArg);
  const envelope = JSON.parse(await readFile(resultArg, "utf8"));
  const errors = validate(caseName, envelope, { runRoot });
  console.log(
    JSON.stringify(
      { case: caseName, pass: errors.length === 0, errors },
      null,
      2,
    ),
  );
  if (errors.length) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 2;
  });
}
