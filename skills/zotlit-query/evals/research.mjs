// Research-case evidence is checked against literals, independently of the agent.
import { isDeepStrictEqual } from "node:util";
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
      if (!isDeepStrictEqual(found.values?.[field], value))
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

export function checkResearch(spec, envelope, runRoot) {
  const expected = resolveExpected(spec, runRoot);
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
  expected,
  answer,
  { runRoot, resultPath, envelope },
) {
  const errors = [];
  if (typeof answer.answer !== "string" || !answer.answer.trim())
    errors.push("answer text is empty");
  if (answer.count !== expected.count) errors.push("answer count is wrong");
  const want = resolveExpected(expected, runRoot);
  const groups = expectedGroups(want, envelope?.request?.group);
  const returned = new Set(
    envelope?.groups?.flatMap((group) =>
      group.rows.map((row) => row.indexedKey),
    ) ?? [],
  );
  errors.push(
    ...checkRows(
      answer.rows,
      want.rows ??
        groups
          .flatMap((g) => g.rows)
          .filter((row) => returned.has(row.indexedKey)),
    ).map((e) => `answer: ${e}`),
  );
  if (
    !isDeepStrictEqual(groupCounts(answer.groups), groupCounts(groups ?? [])) &&
    !(
      want.group === "item.indexedKey" &&
      isDeepStrictEqual(
        groupCounts(answer.groups),
        groupCounts(expectedGroups(want, "item.title")),
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
