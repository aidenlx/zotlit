// The `items` case family: Item Query evidence, answers, prompt, and answer schema.
import { indexedKeyLibrary, librarySelector } from "./libraries.mjs";
import { commonChecks, resultRows } from "./result-rows.mjs";

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

export function checkEnvelope(expected, envelope, context) {
  const { errors, need } = commonChecks(envelope, expected, context);
  for (const field of expected.requiredFields)
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
  const checksStatus = expected.requiredFields.includes(
    'custom["review.status"]',
  );
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
    if (checksStatus)
      need(
        values['custom["review.status"]'] === item.status,
        `wrong review status for ${item.indexedKey}`,
      );
    if (expected.export)
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

function sortedLibraries(libraries) {
  return JSON.stringify(
    libraries.map(librarySelector).sort((a, b) => a.localeCompare(b)),
  );
}

// An editor answer is required only where no author exists; otherwise null is
// accepted, since the request asks for the first author.
function wrongEditor(found, item) {
  return item.firstAuthor === null
    ? found.editor !== item.editor
    : found.editor !== null && found.editor !== item.editor;
}

export function checkAnswer(expected, answer, { resultPath }) {
  const errors = [];
  if (typeof answer.answer !== "string" || !answer.answer.trim())
    errors.push("answer text is empty");
  if (answer.count !== expected.count)
    errors.push(`answer count should be ${expected.count}`);
  if (answer.missingPublicationYears !== (expected.missingYear ?? null))
    errors.push("answer has wrong missing publication-year count");
  if (answer.exportPath !== (expected.export ? resultPath : null))
    errors.push("answer has wrong retained export path");
  const expectedItems = expected.export
    ? []
    : expected.rows.map((row) => ({
        indexedKey: row.indexedKey,
        title: row.title,
        publicationYear: row.year,
        library: indexedKeyLibrary(row.indexedKey),
        firstAuthor: row.firstAuthor,
        editor: row.firstCreator !== row.firstAuthor ? row.firstCreator : null,
      }));
  if (
    !Array.isArray(answer.items) ||
    answer.items.length !== expectedItems.length
  )
    errors.push("answer has wrong Item details");
  else {
    const actual = new Map(answer.items.map((item) => [item.indexedKey, item]));
    if (
      actual.size !== expectedItems.length ||
      expectedItems.some((item) => {
        const found = actual.get(item.indexedKey);
        if (!found) return true;
        const required = [
          "indexedKey",
          "title",
          "publicationYear",
          "library",
          "firstAuthor",
        ];
        if (
          required.some(
            (key) =>
              (key === "library" ? librarySelector(found[key]) : found[key]) !==
              item[key],
          )
        )
          return true;
        return wrongEditor(found, item);
      })
    )
      errors.push("answer has wrong Item details");
  }
  const groups = answer.duplicateKeyGroups;
  const wanted = expected.duplicateKeyGroups ?? [];
  if (wanted.length) {
    if (
      !Array.isArray(groups) ||
      groups.length !== wanted.length ||
      wanted.some(
        (group, index) =>
          groups[index]?.key !== group.key ||
          !Array.isArray(groups[index].libraries) ||
          sortedLibraries(groups[index].libraries) !==
            sortedLibraries(group.libraries),
      )
    )
      errors.push("answer has wrong shared-key libraries");
  } else if (!Array.isArray(groups) || groups.length !== 0)
    errors.push("answer has unexpected shared-key groups");
  return errors;
}

export function prompt(_expected, { preamble, result, retained }) {
  return `${preamble}Save the complete successful zotlit:query JSON envelope at ${result}. If the CLI returns a file receipt, copy the complete file envelope to this evidence path. Read the saved envelope and verify it before answering. The runner will retain this envelope at ${retained} after cleanup. In your final JSON, items must contain every Item detail the user requested (use Library display names or selectors); use null for a missing year, author, or editor. For the export case use an empty items array and set exportPath to ${retained}; otherwise use null. Put the libraries that share a bare key in duplicateKeyGroups when the request asks about it; otherwise use an empty array. State the exact count and missing publication-year count (use null when the request does not ask for it).`;
}

const answerItem = {
  type: "object",
  additionalProperties: false,
  properties: {
    indexedKey: { type: "string" },
    title: { type: "string" },
    publicationYear: { type: ["integer", "null"] },
    library: { type: "string" },
    firstAuthor: { type: ["string", "null"] },
    editor: { type: ["string", "null"] },
  },
  required: [
    "indexedKey",
    "title",
    "publicationYear",
    "library",
    "firstAuthor",
    "editor",
  ],
};
const outputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string" },
    count: { type: "integer" },
    missingPublicationYears: { type: ["integer", "null"] },
    items: { type: "array", items: answerItem },
    duplicateKeyGroups: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          key: { type: "string" },
          libraries: { type: "array", items: { type: "string" } },
        },
        required: ["key", "libraries"],
      },
    },
    exportPath: { type: ["string", "null"] },
  },
  required: [
    "answer",
    "count",
    "missingPublicationYears",
    "items",
    "duplicateKeyGroups",
    "exportPath",
  ],
};

export function answerSchema() {
  return outputSchema;
}

/** Item answers need no evidence beyond the saved envelope. */
export async function retainEvidence() {}
export async function loadEvidence() {
  return {};
}

export function checkRun(_expected, { metrics }) {
  return metrics.itemQueryExitZero < 1
    ? ["agent made no completed Item Query call with exit code zero"]
    : [];
}
