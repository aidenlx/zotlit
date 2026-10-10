// Research-case evidence is checked against literals, independently of the agent.
import { isDeepStrictEqual } from "node:util";

import { librarySelector } from "./libraries.mjs";
export function resolveExpected(value, runRoot) {
  if (typeof value === "string") return value.replaceAll("$RUN", runRoot);
  if (Array.isArray(value))
    return value.map((v) => resolveExpected(v, runRoot));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, resolveExpected(v, runRoot)]),
    );
  return value;
}
function checkRows(actual, expected) {
  const errors = [];
  if (!Array.isArray(actual)) return ["rows are missing"];
  const rows = new Map(actual.map((r) => [r.indexedKey, r]));
  if (rows.size !== actual.length || actual.length !== expected.length)
    errors.push("wrong rows or duplicate identities");
  for (const row of expected) {
    const found = rows.get(row.indexedKey);
    if (!found) {
      errors.push(`missing ${row.indexedKey}`);
      continue;
    }
    for (const [field, value] of Object.entries(row.values))
      if (
        !isDeepStrictEqual(
          field === "library"
            ? librarySelector(found.values?.[field])
            : found.values?.[field],
          value,
        )
      )
        errors.push(`wrong ${field} for ${row.indexedKey}`);
  }
  return errors;
}
function expectedGroups(expected, path) {
  if (expected.group === "item.indexedKey" && path === "item.title")
    return expected.groups
      .map((group) => ({ ...group, value: group.rows[0].values["item.title"] }))
      .sort((a, b) => a.value.localeCompare(b.value, "und"));
  return expected.groups;
}

// Per-paper counts can start from papers or from grouped reading marks.
export function researchExpectation(spec, envelope) {
  if (spec.group !== "item.indexedKey" || envelope.request?.from !== "items")
    return spec;
  const { groups, group: _group, ...rest } = spec;
  return {
    ...rest,
    from: "items",
    count: groups.length,
    fields: ["title"],
    rows: groups.map((g) => ({
      indexedKey: g.value,
      values: { title: g.rows[0].values["item.title"] },
    })),
    paperGroups: groups,
  };
}

function checkPaperCounts(rows, groups, required = true) {
  const errors = [];
  for (const row of rows ?? []) {
    const values = row.values ?? {};
    const counts = [
      ...(Object.hasOwn(values, "annotations.length")
        ? [values["annotations.length"]]
        : []),
      ...["annotations[]", "annotations"]
        .filter((field) => Object.hasOwn(values, field))
        .map((field) =>
          Array.isArray(values[field]) ? values[field].length : null,
        ),
    ];
    const expected = groups.find((g) => g.value === row.indexedKey)?.count;
    if (
      (required && !counts.length) ||
      counts.some((count) => count !== expected)
    )
      errors.push(`wrong mark count for ${row.indexedKey}`);
  }
  return errors;
}

export function checkResearch(spec, envelope, runRoot) {
  const expected = resolveExpected(
    researchExpectation(spec, envelope),
    runRoot,
  );
  const errors = [];
  if (envelope.request?.from !== expected.from)
    errors.push(`wrong Query Dataset; expected ${expected.from}`);
  for (const field of expected.fields)
    if (!envelope.request?.fields?.includes(field))
      errors.push(`missing projected field ${field}`);
  if (expected.groups) {
    if (
      envelope.request?.group !== expected.group &&
      !(
        expected.group === "item.indexedKey" &&
        envelope.request?.group === "item.title"
      )
    )
      errors.push("wrong group path");
    if (envelope.totalCount !== expected.count) errors.push("wrong totalCount");
    if (
      !Array.isArray(envelope.groups) ||
      envelope.groups.length !== expected.groups.length
    )
      return [...errors, "wrong groups"];
    const groups = expectedGroups(expected, envelope.request?.group);
    for (let i = 0; i < groups.length; i++) {
      const actual = envelope.groups[i],
        wanted = groups[i];
      if (actual.value !== wanted.value || actual.count !== wanted.count)
        errors.push("wrong group value, order, or count");
      const keys = new Set((actual.rows ?? []).map((row) => row.indexedKey));
      const limit = envelope.request?.limit ?? wanted.count;
      if (actual.rows?.length !== Math.min(limit, wanted.count))
        errors.push("wrong per-group sample size");
      errors.push(
        ...checkRows(
          actual.rows,
          wanted.rows.filter((row) => keys.has(row.indexedKey)),
        ),
      );
    }
  } else errors.push(...checkRows(envelope.rows, expected.rows));
  if (expected.paperGroups)
    errors.push(...checkPaperCounts(envelope.rows, expected.paperGroups));
  return errors;
}
function schemaFor(value) {
  if (value === null) return { type: "null" };
  if (Array.isArray(value))
    return {
      type: "array",
      items: value.length
        ? unionSchemas(value.map(schemaFor))
        : { type: "string" },
    };
  if (typeof value === "object")
    return {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, schemaFor(v)]),
      ),
      required: Object.keys(value),
    };
  return { type: typeof value === "number" ? "integer" : typeof value };
}
// Merge shapes, not literal values, so the agent learns no expected answer.
function unionSchemas(schemas) {
  const unique = [
    ...new Map(schemas.map((s) => [JSON.stringify(s), s])).values(),
  ];
  return unique.length === 1 ? unique[0] : { anyOf: unique };
}
export function researchSchema(expected) {
  const rows = expected.rows ?? expected.groups.flatMap((g) => g.rows);
  const rowSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      indexedKey: { type: "string" },
      values: {
        type: "object",
        additionalProperties: false,
        properties: Object.fromEntries(
          expected.fields.map((field) => [
            field,
            unionSchemas(rows.map((r) => schemaFor(r.values[field]))),
          ]),
        ),
        required: expected.fields,
      },
    },
    required: ["indexedKey", "values"],
  };
  if (expected.group === "item.indexedKey") {
    const summary = schemaFor({
      indexedKey: "",
      type: "",
      text: "",
      comment: "",
      pageLabel: "",
      pageIndex: 0,
    });
    for (const field of ["text", "comment", "pageLabel", "pageIndex"])
      summary.properties[field].type = [summary.properties[field].type, "null"];
    rowSchema.properties.values = {
      anyOf: [
        rowSchema.properties.values,
        schemaFor({ title: "", "annotations.length": 0 }),
        {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            "annotations[]": { type: "array", items: summary },
          },
          required: ["title", "annotations[]"],
        },
      ],
    };
  }
  const properties = {
    answer: { type: "string" },
    count: { type: "integer" },
    rows: { type: "array", items: rowSchema },
    groups: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          value: { type: ["string", "integer", "null"] },
          count: { type: "integer" },
        },
        required: ["value", "count"],
      },
    },
    limitation: { type: ["string", "null"] },
    exportPath: { type: ["string", "null"] },
  };
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  };
}
function groupCounts(groups) {
  return groups
    ?.map(({ value, count }) => ({ value, count }))
    .sort((a, b) =>
      JSON.stringify(a.value).localeCompare(JSON.stringify(b.value)),
    );
}

export function checkResearchAnswer(
  spec,
  answer,
  { runRoot, resultPath, envelope },
) {
  const expected = researchExpectation(spec, envelope);
  const errors = [];
  if (typeof answer.answer !== "string" || !answer.answer.trim())
    errors.push("answer text is empty");
  if (answer.count !== expected.count) errors.push("answer count is wrong");
  const want = resolveExpected(expected, runRoot);
  const groups =
    want.paperGroups ?? expectedGroups(want, envelope?.request?.group);
  const returned = new Set(
    envelope?.groups?.flatMap((group) =>
      group.rows.map((row) => row.indexedKey),
    ) ?? [],
  );
  errors.push(
    ...checkRows(
      want.paperGroups
        ? answer.rows?.map((row) => ({
            ...row,
            values: {
              ...row.values,
              title: row.values?.title ?? row.values?.["item.title"],
            },
          }))
        : answer.rows,
      want.rows ??
        groups
          .flatMap((g) => g.rows)
          .filter((row) => returned.has(row.indexedKey)),
    ).map((e) => `answer: ${e}`),
  );
  const countsInRows = want.paperGroups && answer.groups?.length === 0;
  if (want.paperGroups)
    errors.push(
      ...checkPaperCounts(answer.rows, want.paperGroups, countsInRows),
    );
  if (
    !countsInRows &&
    !isDeepStrictEqual(groupCounts(answer.groups), groupCounts(groups ?? [])) &&
    !(
      (want.group === "item.indexedKey" || want.paperGroups) &&
      isDeepStrictEqual(
        groupCounts(answer.groups),
        groupCounts(
          expectedGroups(
            { ...want, group: "item.indexedKey", groups },
            "item.title",
          ),
        ),
      )
    )
  )
    errors.push("answer has wrong group counts");
  if (answer.limitation !== (expected.limitation ?? null))
    errors.push("answer has wrong capability limitation");
  if (
    answer.exportPath !==
    (expected.csv ? resultPath.replace(/result\.json$/, "advisor.csv") : null)
  )
    errors.push("answer has wrong CSV export path");
  return errors;
}
