// The `annotations` case family: Annotation Query evidence, answers, prompt, and answer schema.
import { cp, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { indexedKeyLibrary, librarySelector } from "./libraries.mjs";
import { commonChecks, resultRows } from "./result-rows.mjs";

const oracle = JSON.parse(
  await readFile(new URL("./oracle.json", import.meta.url), "utf8"),
);

// Oracle names for first-row evidence: the row value path and the error label.
const evidenceFields = {
  tags: { path: "tags", label: "Annotation Tags" },
  hasExcerptImage: {
    path: "hasExcerptImage",
    label: "Excerpt Image applicability",
  },
  itemTitle: { path: "item.title", label: "parent Item title" },
  text: { path: "text", label: "quoted text" },
  position: { path: "position", label: "requested position" },
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

/** Ordered cases compare reading order; the rest compare key sets. */
function keyOrder(expected, keys) {
  return JSON.stringify(
    expected.ordered ? keys : [...keys].sort((a, b) => a.localeCompare(b)),
  );
}

function storagePath(runRoot, spec) {
  const attachmentKey = spec.attachment.endsWith("g118")
    ? spec.attachment.slice(0, -4)
    : spec.attachment;
  return join(
    runRoot,
    "zotero-data",
    "storage",
    attachmentKey,
    basename(spec.sourceSuffix),
  );
}

export function checkEnvelope(expected, envelope, context) {
  const { errors, need } = commonChecks(envelope, expected, context);
  const request = envelope?.request ?? {};
  for (const field of expected.requiredFields ?? [])
    need(projected(request.fields, field), `${field} was not requested`);
  for (const fragment of expected.filterIncludes ?? [])
    need(
      request.filter?.includes(fragment),
      `filter does not contain ${fragment}`,
    );
  const rows = resultRows(envelope);
  need(Array.isArray(rows), "full result rows are missing");
  if (!Array.isArray(rows)) return errors;
  need(rows.length === expected.count, `expected ${expected.count} rows`);
  need(
    keyOrder(
      expected,
      rows.map((row) => row.indexedKey),
    ) === keyOrder(expected, expected.keys),
    "Annotation Rows have wrong keys or order",
  );
  const byKey = new Map(rows.map((row) => [row.indexedKey, row]));
  need(byKey.size === rows.length, "duplicate Annotation Indexed Key");
  // Cases on one paper name its parents; the others name per-row oracle facts.
  if (expected.itemKey)
    for (const row of rows) {
      need(
        row.itemIndexedKey === expected.itemKey,
        `${row.indexedKey} has wrong parent Item`,
      );
      need(
        row.attachmentIndexedKey === expected.attachmentKey,
        `${row.indexedKey} has wrong parent Attachment`,
      );
    }
  else
    for (const key of expected.keys) {
      const spec = oracle.annotationRows[key];
      const row = byKey.get(spec.key);
      if (!row) continue;
      need(
        row.itemIndexedKey === spec.item,
        `${spec.key} has wrong parent Item`,
      );
      need(
        row.attachmentIndexedKey === spec.attachment,
        `${spec.key} has wrong parent Attachment`,
      );
      const values = row.values ?? {};
      for (const field of expected.requiredFields) {
        if (field.startsWith("attachment.")) continue;
        need(
          isDeepStrictEqual(values[field] ?? null, spec[field] ?? null),
          `${spec.key} has wrong ${field}`,
        );
      }
      if (expected.requiredFields.includes("attachment.path"))
        need(
          sourcePath(values) === storagePath(context.runRoot, spec),
          `${spec.key} has wrong source file`,
        );
      if (expected.requiredFields.includes("attachment.exists"))
        need(
          sourceExists(values) === spec.sourceExists,
          `${spec.key} has wrong attachment.exists`,
        );
    }
  if (expected.sourceSuffix)
    for (const row of rows)
      need(
        sourcePath(row.values)?.endsWith(expected.sourceSuffix),
        `${row.indexedKey} has no source path`,
      );
  if (expected.details)
    for (const row of rows) {
      need(
        typeof row.values?.type === "string",
        `${row.indexedKey} has no type`,
      );
      need(
        typeof row.values?.pageLabel === "string",
        `${row.indexedKey} has no page label`,
      );
      const detail = expected.details[row.indexedKey];
      if (detail)
        for (const field of ["type", "pageLabel", "text", "comment"])
          need(
            (row.values?.[field] ?? null) === detail[field],
            `${row.indexedKey} has wrong ${field}`,
          );
    }
  for (const name of expected.evidence ?? [])
    need(
      isDeepStrictEqual(
        rows[0]?.values?.[evidenceFields[name].path],
        expected[name],
      ),
      `wrong ${evidenceFields[name].label}`,
    );
  if (expected.keys.some((key) => !key.endsWith("g118")))
    need(
      envelope?.libraries?.some((library) => library.type === "personal"),
      "My Library was not queried",
    );
  if (expected.keys.some((key) => key.endsWith("g118")))
    need(
      envelope?.libraries?.some((library) => library.groupID === 118),
      "Lab Archive was not queried",
    );
  return errors;
}

function rowValue(field, row, annotation) {
  const values = row.values ?? {};
  switch (field) {
    case "attachmentPath":
      return sourcePath(values);
    case "attachmentExists":
      return sourceExists(values) ?? null;
    case "library":
      return indexedKeyLibrary(annotation.indexedKey);
    case "itemIndexedKey":
    case "attachmentIndexedKey":
      return row[field];
    case "itemTitle":
      return values["item.title"];
    default:
      return values[field] ?? null;
  }
}

export function checkAnswer(
  expected,
  answer,
  { envelope, imageReceipt, resultPath },
) {
  const errors = [];
  if (typeof answer.answer !== "string" || !answer.answer.trim())
    errors.push("answer text is empty");
  if (answer.count !== expected.count)
    errors.push(`answer count should be ${expected.count}`);
  if (
    !Array.isArray(answer.annotations) ||
    keyOrder(
      expected,
      answer.annotations.map(({ indexedKey }) => indexedKey),
    ) !== keyOrder(expected, expected.keys)
  )
    errors.push("answer has wrong Annotation keys or reading order");
  const rows = new Map(
    (resultRows(envelope) ?? []).map((row) => [row.indexedKey, row]),
  );
  for (const annotation of answer.annotations ?? []) {
    const row = rows.get(annotation.indexedKey);
    if (!row) {
      errors.push(`answer has no evidence for ${annotation.indexedKey}`);
      continue;
    }
    for (const field of expected.answerFields)
      if (
        !isDeepStrictEqual(
          field === "library"
            ? librarySelector(annotation[field])
            : annotation[field],
          rowValue(field, row, annotation),
        )
      )
        errors.push(
          `answer has wrong ${field === "attachmentPath" ? "source path" : field} for ${annotation.indexedKey}`,
        );
  }
  if (expected.export && answer.exportPath !== resultPath)
    errors.push("answer has wrong retained export path");
  if (
    expected.evidence?.includes("position") &&
    !isDeepStrictEqual(answer.annotations?.[0]?.position, expected.position)
  )
    errors.push("answer has wrong requested position");
  if (expected.excerptImage) {
    if (
      answer.imagePath !== imageReceipt?.path ||
      answer.imageProvenance !== imageReceipt?.provenance ||
      !expected.provenance.includes(answer.imageProvenance) ||
      answer.imageFormat !== expected.format ||
      answer.validPng !== true
    )
      errors.push("answer has wrong Excerpt Image result");
  } else if (
    answer.imagePath !== null ||
    answer.imageProvenance !== null ||
    answer.imageFormat !== null ||
    answer.validPng !== null
  ) {
    errors.push("answer has an unexpected Excerpt Image result");
  }
  return errors;
}

export function prompt(expected, { preamble, agentRoot, result, retained }) {
  const imageResult = join(agentRoot, "image-result.json");
  const imageInstruction = expected.excerptImage
    ? ` Save the successful zotlit:annotation-image JSON response at ${imageResult}, read the returned file, and verify its PNG signature. Set the four image result fields from that response and check.`
    : " Set imagePath, imageProvenance, imageFormat, and validPng to null.";
  const queryInstruction = expected.export
    ? ` Use zotlit:query from=annotations output=${result} to create the complete JSON export with limit=all. Save the command's JSON file receipt at ${join(agentRoot, "export-receipt.json")}. Read and verify the exported envelope. The runner will retain the file at ${retained}; report that retained path as exportPath.`
    : ` Save the complete successful zotlit:query from=annotations JSON envelope at ${result}; use limit=all and keep rows inline. Read and verify the saved envelope before answering.`;
  return `${preamble}${queryInstruction} In your final JSON, annotations must contain every requested detail from those rows, with null for an unavailable value.${imageInstruction}`;
}

const outputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string" },
    count: { type: "integer" },
    annotations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          indexedKey: { type: "string" },
          itemIndexedKey: { type: "string" },
          attachmentIndexedKey: { type: "string" },
          attachmentExists: { type: "boolean" },
          library: { type: "string" },
          type: { type: "string" },
          colorName: { type: ["string", "null"] },
          pageIndex: { type: ["integer", "null"] },
          pageLabel: { type: ["string", "null"] },
          text: { type: ["string", "null"] },
          comment: { type: ["string", "null"] },
          tags: { type: "array", items: { type: "string" } },
          itemTitle: { type: "string" },
          attachmentPath: { type: ["string", "null"] },
          hasExcerptImage: { type: "boolean" },
          position: {
            anyOf: [
              {
                type: "object",
                additionalProperties: false,
                properties: {
                  kind: { type: "string" },
                  pageIndex: { type: ["integer", "null"] },
                  rects: {
                    type: "array",
                    items: {
                      type: "array",
                      items: { type: "number" },
                    },
                  },
                },
                required: ["kind", "pageIndex", "rects"],
              },
              { type: "null" },
            ],
          },
        },
      },
    },
    imagePath: { type: ["string", "null"] },
    exportPath: { type: "string" },
    imageProvenance: { type: ["string", "null"] },
    imageFormat: { type: ["string", "null"] },
    validPng: { type: ["boolean", "null"] },
  },
  required: [
    "answer",
    "count",
    "annotations",
    "imagePath",
    "imageProvenance",
    "imageFormat",
    "validPng",
  ],
};

export function answerSchema(expected) {
  const fields = ["indexedKey", ...expected.answerFields];
  const annotations = outputSchema.properties.annotations;
  const properties = { ...outputSchema.properties };
  if (!expected.export) delete properties.exportPath;
  return {
    ...outputSchema,
    properties: {
      ...properties,
      annotations: {
        ...annotations,
        items: {
          ...annotations.items,
          properties: Object.fromEntries(
            fields.map((field) => [field, annotations.items.properties[field]]),
          ),
          required: fields,
        },
      },
    },
    required: [
      ...outputSchema.required,
      ...(expected.export ? ["exportPath"] : []),
    ],
  };
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Copies receipts and the Excerpt Image out of folders that cleanup removes,
 * so a regrade reads the same evidence as the live run.
 */
export async function retainEvidence(expected, { agentRoot, root }) {
  if (expected.export)
    await cp(
      join(agentRoot, "export-receipt.json"),
      join(root, "export-receipt.json"),
    );
  if (expected.excerptImage) {
    await cp(join(agentRoot, "image-result.json"), join(root, "image.json"));
    const receipt = JSON.parse(
      await readFile(join(root, "image.json"), "utf8"),
    );
    if (typeof receipt.path === "string")
      await cp(receipt.path, join(root, "excerpt-image.png"));
  }
}

export async function loadEvidence(expected, root) {
  const evidence = {};
  if (expected.export)
    evidence.exportReceipt = JSON.parse(
      await readFile(join(root, "export-receipt.json"), "utf8"),
    );
  if (expected.excerptImage) {
    evidence.imageReceipt = JSON.parse(
      await readFile(join(root, "image.json"), "utf8"),
    );
    // Runs saved before the copy was retained fall back to the receipt path.
    if (typeof evidence.imageReceipt.path === "string")
      evidence.imageBytes = await readFile(
        join(root, "excerpt-image.png"),
      ).catch(() => readFile(evidence.imageReceipt.path));
  }
  return evidence;
}

export function checkRun(
  expected,
  { metrics, resultBytes, exportReceipt, imageReceipt, imageBytes, agentRoot },
) {
  const errors = [];
  if (
    expected.export &&
    (exportReceipt.ok !== true ||
      exportReceipt.file?.path !== join(agentRoot, "query-result.json") ||
      exportReceipt.file?.format !== "json" ||
      exportReceipt.file?.bytes !== resultBytes)
  )
    errors.push("wrong Annotation Query export receipt");
  if (expected.excerptImage) {
    if (
      imageReceipt.ok !== true ||
      imageReceipt.key !== expected.keys[0] ||
      imageReceipt.format !== expected.format ||
      !expected.provenance.includes(imageReceipt.provenance)
    )
      errors.push("wrong Excerpt Image receipt");
    if (typeof imageReceipt.path !== "string")
      errors.push("Excerpt Image receipt has no path");
    else if (!imageBytes.subarray(0, 8).equals(PNG_SIGNATURE))
      errors.push("Excerpt Image is not a PNG");
  }
  if (metrics.annotationQueryExitZero < 1)
    errors.push(
      "agent made no completed Annotation Query call with exit code zero",
    );
  if (expected.excerptImage && metrics.imageExitZero < 1)
    errors.push(
      "agent made no completed Annotation Image call with exit code zero",
    );
  return errors;
}
