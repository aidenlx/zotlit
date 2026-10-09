#!/usr/bin/env node
// One bounded persona evaluation. Run data is private; compact evidence remains.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";

import { validate } from "./check.mjs";

const repo = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const cases = JSON.parse(
  await readFile(new URL("./cases.json", import.meta.url), "utf8"),
);
const oracle = JSON.parse(
  await readFile(new URL("./oracle.json", import.meta.url), "utf8"),
);
const fixtureTool = join(repo, "packages/scripts/scripts/obsidian-vault.ts");
const cliTool = join(repo, "packages/scripts/scripts/obsidian-cli.ts");
const prepareTool = fileURLToPath(new URL("./prepare.mjs", import.meta.url));
const skillFile = join(repo, "skills/zotlit-query/SKILL.md");
const itemCatalogFile = join(
  repo,
  "packages/item-query/dist/item-query.schema.json",
);
const annotationCatalogFile = join(
  repo,
  "packages/item-query/dist/annotation-query.schema.json",
);
const itemCases = new Set(["include", "export", "edge"]);
const mixedQueryCases = new Set(["reading_plan"]);
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
const itemOutputSchema = {
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
const annotationOutputSchema = {
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
    papers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          indexedKey: { type: "string" },
          title: { type: "string" },
          library: { type: "string" },
          annotationCount: { type: "integer" },
        },
        required: ["indexedKey", "title", "library", "annotationCount"],
      },
    },
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

const annotationAnswerFields = {
  annotations: ["type", "pageLabel", "text", "comment", "attachmentPath"],
  mixed: ["itemTitle", "tags", "hasExcerptImage"],
  position: ["position", "attachmentPath"],
  image: [],
  reading_plan: ["itemIndexedKey", "type", "pageLabel", "text", "comment"],
  shared_marks: ["itemIndexedKey", "library", "text", "colorName"],
  attachment: [
    "itemIndexedKey",
    "attachmentIndexedKey",
    "type",
    "pageLabel",
    "text",
    "comment",
    "attachmentPath",
  ],
  colors: ["text", "colorName", "tags", "pageIndex"],
  reverse_pages: ["type", "pageLabel", "pageIndex", "text"],
  missing_source: [
    "attachmentIndexedKey",
    "comment",
    "attachmentPath",
    "attachmentExists",
  ],
  repair_filter: ["itemIndexedKey", "text", "colorName"],
  export_annotations: [
    "itemIndexedKey",
    "attachmentIndexedKey",
    "type",
    "pageLabel",
    "text",
    "comment",
    "attachmentPath",
  ],
};

function annotationSchema(caseName) {
  const fields = ["indexedKey", ...annotationAnswerFields[caseName]];
  const annotations = annotationOutputSchema.properties.annotations;
  const properties = { ...annotationOutputSchema.properties };
  if (!mixedQueryCases.has(caseName)) delete properties.papers;
  if (caseName !== "export_annotations") delete properties.exportPath;
  return {
    ...annotationOutputSchema,
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
      ...annotationOutputSchema.required,
      ...(mixedQueryCases.has(caseName) ? ["papers"] : []),
      ...(caseName === "export_annotations" ? ["exportPath"] : []),
    ],
  };
}

function fail(message) {
  throw new Error(message);
}
function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function parseOptions(argv) {
  const usage =
    "usage: node run.mjs <case> --model <model> --effort <low|medium|high|xhigh> [--timeout-minutes 10]";
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      model: { type: "string" },
      effort: { type: "string" },
      "timeout-minutes": { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) return null;
  const [caseName] = positionals;
  if (
    positionals.length !== 1 ||
    !cases[caseName] ||
    !values.model ||
    !values.effort
  )
    fail(usage);
  if (!["low", "medium", "high", "xhigh"].includes(values.effort))
    fail("invalid effort");
  const minutes = Number(values["timeout-minutes"] ?? 10);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 30)
    fail("timeout must be 1–30 minutes");
  return {
    caseName,
    model: values.model,
    effort: values.effort,
    agentTimeoutMs: minutes * 60_000,
  };
}

/** A bounded process, with stdout/stderr captured for evidence and test injection. */
export function runProcess(
  command,
  args,
  { cwd, input = "", timeoutMs = 180_000, signal, spawnImpl = spawn } = {},
) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      resolve({
        code: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        aborted: true,
      });
      return;
    }
    const child = spawnImpl(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let stdout = "",
      stderr = "",
      timedOut = false,
      aborted = false,
      settled = false;
    let escalation, forceFinish;
    const kill = (name) => {
      try {
        if (process.platform !== "win32" && child.pid)
          process.kill(-child.pid, name);
        else child.kill(name);
      } catch {
        /* the process group already exited */
      }
    };
    const settle = (code, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(escalation);
      clearTimeout(forceFinish);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve({ code, stdout, stderr, timedOut, aborted });
    };
    const stop = (reason) => {
      if (settled || timedOut || aborted) return;
      if (reason === "timeout") timedOut = true;
      else aborted = true;
      kill("SIGTERM");
      escalation = setTimeout(() => kill("SIGKILL"), 5_000);
      forceFinish = setTimeout(() => {
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
        settle(null);
      }, 8_000);
    };
    const onAbort = () => stop("abort");
    const timer = setTimeout(() => stop("timeout"), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => settle(null, error));
    child.on("close", (code) => settle(code));
    child.stdin.on("error", () => {
      /* an early process exit is reported by close/error */
    });
    child.stdin.end(input);
  });
}

function required(result, stage) {
  if (result.timedOut) fail(`${stage} timed out`);
  if (result.aborted) fail(`${stage} interrupted`);
  if (result.code !== 0)
    fail(`${stage} failed (${result.code}): ${result.stderr.slice(-2000)}`);
  return result.stdout;
}

export function measureEvents(jsonl) {
  let calls = 0,
    queryAttempts = 0,
    queryExitZero = 0,
    itemQueryAttempts = 0,
    itemQueryExitZero = 0,
    annotationQueryAttempts = 0,
    annotationQueryExitZero = 0,
    imageAttempts = 0,
    imageExitZero = 0,
    queryRetries = 0,
    contextualBytes = 0,
    failedQuery = false;
  const seen = new Set();
  const forbiddenReads = [];
  for (const line of jsonl.split("\n")) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const item = event.item;
    if (event.type !== "item.completed" || item?.type !== "command_execution")
      continue;
    if (item.id !== undefined) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
    }
    calls++;
    if (
      typeof item.command === "string" &&
      /(?:oracle\.json|skills\/zotlit-query\/evals\/)/.test(item.command)
    )
      forbiddenReads.push(item.command);
    const isCli =
      typeof item.command === "string" &&
      item.command.includes("obsidian-cli.ts");
    const queryKind = !isCli
      ? null
      : /\bzotlit:annotation-query\b/.test(item.command) &&
          !/\bzotlit:annotation-query-(guide|schema)\b/.test(item.command)
        ? "annotation"
        : /\bzotlit:item-query\b/.test(item.command) &&
            !/\bzotlit:item-query-(guide|schema|cancel)\b/.test(item.command)
          ? "item"
          : null;
    if (queryKind) {
      queryAttempts++;
      if (queryKind === "item") itemQueryAttempts++;
      else annotationQueryAttempts++;
      if (failedQuery) queryRetries++;
      failedQuery = item.exit_code !== 0;
      try {
        if (JSON.parse(item.aggregated_output).ok === false) failedQuery = true;
      } catch {
        /* a plain-text error is counted by its nonzero exit */
      }
      if (item.exit_code === 0) {
        queryExitZero++;
        if (queryKind === "item") itemQueryExitZero++;
        else annotationQueryExitZero++;
      }
    }
    if (isCli && /\bzotlit:annotation-image\b/.test(item.command)) {
      imageAttempts++;
      if (item.exit_code === 0) imageExitZero++;
    }
    if (typeof item.aggregated_output === "string")
      contextualBytes += Buffer.byteLength(item.aggregated_output);
  }
  return {
    calls,
    queryAttempts,
    queryExitZero,
    itemQueryAttempts,
    itemQueryExitZero,
    annotationQueryAttempts,
    annotationQueryExitZero,
    imageAttempts,
    imageExitZero,
    queryRetries,
    contextualBytes,
    forbiddenReads,
  };
}

function checkItemAnswer(caseName, answer, resultPath) {
  const errors = [];
  const expected = oracle.cases[caseName];
  if (typeof answer.answer !== "string" || !answer.answer.trim())
    errors.push("answer text is empty");
  if (answer.count !== expected.count)
    errors.push(`answer count should be ${expected.count}`);
  if (answer.missingPublicationYears !== (expected.missingYear ?? null))
    errors.push("answer has wrong missing publication-year count");
  if (answer.exportPath !== (caseName === "export" ? resultPath : null))
    errors.push("answer has wrong retained export path");
  const expectedItems =
    caseName === "export"
      ? []
      : expected.rows.map((row) => ({
          indexedKey: row.indexedKey,
          title: row.title,
          publicationYear: row.year,
          library: row.indexedKey.endsWith("g118")
            ? "Lab Archive"
            : "My Library",
          firstAuthor: row.firstAuthor,
          editor:
            row.firstCreator !== row.firstAuthor ? row.firstCreator : null,
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
        if (required.some((key) => found[key] !== item[key])) return true;
        return caseName === "edge" && item.firstAuthor === null
          ? found.editor !== item.editor
          : found.editor !== null && found.editor !== item.editor;
      })
    )
      errors.push("answer has wrong Item details");
  }
  const groups = answer.duplicateKeyGroups;
  if (caseName === "edge") {
    if (
      !Array.isArray(groups) ||
      groups.length !== 1 ||
      groups[0]?.key !== "EVALSAME" ||
      !Array.isArray(groups[0].libraries) ||
      JSON.stringify(
        [...groups[0].libraries].sort((a, b) => a.localeCompare(b)),
      ) !==
        JSON.stringify(
          ["My Library", "Lab Archive"].sort((a, b) => a.localeCompare(b)),
        )
    )
      errors.push("answer has wrong shared-key libraries");
  } else if (!Array.isArray(groups) || groups.length !== 0)
    errors.push("answer has unexpected shared-key groups");
  return errors;
}

function checkAnnotationAnswer(
  caseName,
  answer,
  { envelope, imageReceipt, resultPath },
) {
  const errors = [];
  const expected = oracle.cases[caseName];
  if (typeof answer.answer !== "string" || !answer.answer.trim())
    errors.push("answer text is empty");
  if (answer.count !== expected.count)
    errors.push(`answer count should be ${expected.count}`);
  if (
    !Array.isArray(answer.annotations) ||
    JSON.stringify(
      ["reverse_pages", "attachment", "export_annotations"].includes(caseName)
        ? answer.annotations.map(({ indexedKey }) => indexedKey)
        : answer.annotations
            .map(({ indexedKey }) => indexedKey)
            .sort((a, b) => a.localeCompare(b)),
    ) !==
      JSON.stringify(
        ["reverse_pages", "attachment", "export_annotations"].includes(caseName)
          ? expected.keys
          : [...expected.keys].sort((a, b) => a.localeCompare(b)),
      )
  )
    errors.push("answer has wrong Annotation keys or reading order");
  const rows = new Map(
    (envelope.rows ?? []).map((row) => [row.indexedKey, row.values ?? {}]),
  );
  for (const annotation of answer.annotations ?? []) {
    const values = rows.get(annotation.indexedKey);
    if (!values) continue;
    for (const field of annotationAnswerFields[caseName]) {
      const value =
        field === "attachmentPath"
          ? (values.attachment?.path ?? values["attachment.path"] ?? null)
          : field === "attachmentExists"
            ? (values.attachment?.exists ?? values["attachment.exists"] ?? null)
            : field === "library"
              ? annotation.indexedKey.endsWith("g118")
                ? "Lab Archive"
                : "My Library"
              : field === "itemIndexedKey" || field === "attachmentIndexedKey"
                ? envelope.rows.find(
                    (row) => row.indexedKey === annotation.indexedKey,
                  )?.[field]
                : field === "itemTitle"
                  ? values["item.title"]
                  : (values[field] ?? null);
      if (!isDeepStrictEqual(annotation[field], value))
        errors.push(
          `answer has wrong ${field === "attachmentPath" ? "source path" : field} for ${annotation.indexedKey}`,
        );
    }
  }
  if (mixedQueryCases.has(caseName)) {
    const actual = answer.papers;
    const papers = Array.isArray(actual)
      ? new Map(actual.map((paper) => [paper?.indexedKey, paper]))
      : null;
    if (
      !papers ||
      actual.length !== expected.items.length ||
      papers.size !== actual.length ||
      expected.items.some((paper) => {
        const candidate = papers.get(paper.indexedKey);
        return (
          !candidate ||
          candidate.title !== paper.title ||
          candidate.library !== paper.library ||
          candidate.annotationCount !== paper.annotationCount
        );
      })
    )
      errors.push("answer has wrong paper counts, including unmarked papers");
  }
  if (caseName === "export_annotations" && answer.exportPath !== resultPath)
    errors.push("answer has wrong retained export path");
  if (caseName === "position") {
    const annotation = answer.annotations?.[0];
    if (!isDeepStrictEqual(annotation?.position, expected.position))
      errors.push("answer has wrong requested position");
  }
  if (caseName === "image") {
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

/** Pure final-answer check for the runner and saved-response regrades. */
export function checkAnswer(caseName, answer, context) {
  return itemCases.has(caseName)
    ? checkItemAnswer(caseName, answer, context.resultPath)
    : checkAnnotationAnswer(caseName, answer, context);
}

function prompt(caseName, vaultId, agentRoot) {
  const result = join(agentRoot, "query-result.json");
  const retained = resolve(agentRoot, "..", "result.json");
  const itemCatalog = join(
    agentRoot,
    "packages/item-query/dist/item-query.schema.json",
  );
  const annotationCatalog = join(
    agentRoot,
    "packages/item-query/dist/annotation-query.schema.json",
  );
  const preamble = `Read ${join(agentRoot, "SKILL.md")} and follow it for this request. Use only the evaluation vault ID ${vaultId}. The Obsidian CLI executable for this session is: node ${cliTool}. Put vault=${vaultId} before every Obsidian command name. The matching development schema catalogs are ${itemCatalog} and ${annotationCatalog}. Read only the copied skill, those catalogs, live CLI output, and files you make for this task; do not read evaluator sources.\n\nUser request: ${cases[caseName]}\n\n`;
  if (itemCases.has(caseName))
    return `${preamble}Save the complete successful zotlit:item-query JSON envelope at ${result}. If the CLI returns a file receipt, copy the complete file envelope to this evidence path. Read the saved envelope and verify it before answering. The runner will retain this envelope at ${retained} after cleanup. In your final JSON, items must contain every Item detail the user requested (use My Library and Lab Archive as library names); use null for a missing year, author, or editor. For the export case use an empty items array and set exportPath to ${retained}; otherwise use null. Put the libraries that share a bare key in duplicateKeyGroups when the request asks about it; otherwise use an empty array. State the exact count and missing publication-year count (use null when the request does not ask for it).`;
  const imageResult = join(agentRoot, "image-result.json");
  const imageInstruction =
    caseName === "image"
      ? ` Save the successful zotlit:annotation-image JSON response at ${imageResult}, read the returned file, and verify its PNG signature. Set the four image result fields from that response and check.`
      : " Set imagePath, imageProvenance, imageFormat, and validPng to null.";
  const itemInstruction = mixedQueryCases.has(caseName)
    ? ` Save the complete successful zotlit:item-query JSON envelope at ${join(agentRoot, "item-result.json")}; use limit=all and keep rows inline. Derive papers, including zero-mark papers, from that Item result.`
    : "";
  const queryInstruction =
    caseName === "export_annotations"
      ? ` Use zotlit:annotation-query output=${result} to create the complete JSON export with limit=all. Save the command's JSON file receipt at ${join(agentRoot, "export-receipt.json")}. Read and verify the exported envelope. The runner will retain the file at ${retained}; report that retained path as exportPath.`
      : ` Save the complete successful zotlit:annotation-query JSON envelope at ${result}; use limit=all and keep rows inline. Read and verify the saved envelope before answering.`;
  return `${preamble}${itemInstruction}${queryInstruction} In your final JSON, annotations must contain every requested detail from those rows, with null for an unavailable value.${imageInstruction}`;
}

/** The lifecycle seam accepts a fake process runner in tests; production uses spawn. */
export async function runCase(
  { caseName, model, effort, agentTimeoutMs = 600_000 },
  { processRunner = runProcess, runId = randomUUID(), signal } = {},
) {
  if (!cases[caseName]) fail(`unknown case: ${caseName}`);
  if (!/^[a-f0-9-]{36}$/i.test(runId)) fail("run ID must be a UUID");
  const parent = join(repo, ".scratch", "zotlit-query-evals");
  await mkdir(parent, { recursive: true });
  const root = join(parent, runId);
  await mkdir(root);
  const base = join(root, "base"),
    corpus = join(root, "corpus"),
    vault = join(root, `vault-${runId}`),
    agent = join(root, "agent");
  await mkdir(agent);
  const report = {
    case: caseName,
    runId,
    model,
    effort,
    state: "running",
    failureKind: null,
    errors: [],
    metrics: null,
    cleanupRequired: [],
    files: {
      root,
      report: join(root, "report.json"),
      result: join(root, "result.json"),
      itemResult: join(root, "item-result.json"),
      exportReceipt: join(root, "export-receipt.json"),
      image: join(root, "image.json"),
      answer: join(root, "answer.json"),
      check: join(root, "check.json"),
    },
  };
  let vaultOpened = false;
  let vaultId = null;
  try {
    vaultOpened = true; // A failed open may still have registered a window.
    const open = await processRunner(
      process.execPath,
      [fixtureTool, "--fixture-root", base, "--inactive", "open", vault],
      { cwd: repo, timeoutMs: 180_000, signal },
    );
    required(open, "Fixture vault setup");
    vaultId = open.stdout.trim().split("\n")[0];
    if (!vaultId) fail("vault setup returned no vault ID");
    const prepared = await processRunner(
      process.execPath,
      [prepareTool, base, corpus],
      { cwd: repo, timeoutMs: 180_000, signal },
    );
    required(prepared, "Fixture copy and seed");
    const data = join(corpus, "zotero-data");
    const evalCode = `{const pref=app.plugins.plugins.zotlit.services.zoteroPref;pref.setDataDir(${JSON.stringify(data)});"configured"}`;
    const linked = await processRunner(
      process.execPath,
      [cliTool, "--code", evalCode, `vault=${vaultId}`],
      { cwd: repo, timeoutMs: 35_000, signal },
    );
    if (required(linked, "source switch").trim() !== "=> configured")
      fail(`source switch failed: ${linked.stdout}`);
    const expectedDb = join(data, "zotero.sqlite");
    let ready = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      if (signal?.aborted) fail("evaluation interrupted");
      const schema = await processRunner(
        process.execPath,
        [cliTool, `vault=${vaultId}`, "zotlit:item-query-schema"],
        { cwd: repo, timeoutMs: 35_000, signal },
      );
      try {
        const response = JSON.parse(required(schema, "source identity check"));
        if (
          response.ok === true &&
          response.identity?.source?.databasePath === expectedDb &&
          response.identity?.vault?.path === vault
        ) {
          ready = true;
          break;
        }
      } catch {
        /* source refresh may still be in progress */
      }
      await pause(500);
    }
    if (!ready) fail("evaluation vault did not resolve the seeded database");
    report.state = "agent";
    await cp(skillFile, join(agent, "SKILL.md"));
    const copiedItemCatalog = join(
      agent,
      "packages/item-query/dist/item-query.schema.json",
    );
    const copiedAnnotationCatalog = join(
      agent,
      "packages/item-query/dist/annotation-query.schema.json",
    );
    await mkdir(resolve(copiedItemCatalog, ".."), { recursive: true });
    await cp(itemCatalogFile, copiedItemCatalog);
    await cp(annotationCatalogFile, copiedAnnotationCatalog);
    await writeFile(
      join(agent, "answer.schema.json"),
      JSON.stringify(
        itemCases.has(caseName) ? itemOutputSchema : annotationSchema(caseName),
        null,
        2,
      ),
    );
    const answerPath = join(agent, "answer.json");
    const run = await processRunner(
      "codex",
      [
        "exec",
        "--json",
        "--ephemeral",
        "--skip-git-repo-check",
        "--sandbox",
        "workspace-write",
        "--cd",
        agent,
        "--model",
        model,
        "-c",
        `model_reasoning_effort=${effort}`,
        "--output-schema",
        join(agent, "answer.schema.json"),
        "--output-last-message",
        answerPath,
        "-",
      ],
      {
        cwd: agent,
        input: prompt(caseName, vaultId, agent),
        timeoutMs: agentTimeoutMs,
        signal,
      },
    );
    await writeFile(join(root, "agent-events.jsonl"), run.stdout);
    await writeFile(join(root, "agent-stderr.txt"), run.stderr);
    report.metrics = measureEvents(run.stdout);
    report.metrics.agentExitCode = run.code;
    report.metrics.agentTimedOut = run.timedOut;
    report.metrics.agentAborted = run.aborted ?? false;
    if (run.timedOut || run.aborted || run.code !== 0) {
      report.failureKind = "environment";
      fail(
        `agent execution ${run.timedOut ? "timed out" : run.aborted ? "interrupted" : `exited ${run.code}`}`,
      );
    }
    const answer = JSON.parse(await readFile(answerPath, "utf8"));
    report.answer = answer;
    await cp(answerPath, report.files.answer);
    await cp(join(agent, "query-result.json"), report.files.result);
    const envelope = JSON.parse(await readFile(report.files.result, "utf8"));
    const exportErrors = [];
    if (caseName === "export_annotations") {
      await cp(join(agent, "export-receipt.json"), report.files.exportReceipt);
      const receipt = JSON.parse(
        await readFile(report.files.exportReceipt, "utf8"),
      );
      const bytes = Buffer.byteLength(await readFile(report.files.result));
      if (
        receipt.ok !== true ||
        receipt.file?.path !== join(agent, "query-result.json") ||
        receipt.file?.format !== "json" ||
        receipt.file?.bytes !== bytes
      )
        exportErrors.push("wrong Annotation Query export receipt");
    }
    let itemEnvelope;
    if (mixedQueryCases.has(caseName)) {
      await cp(join(agent, "item-result.json"), report.files.itemResult);
      itemEnvelope = JSON.parse(
        await readFile(report.files.itemResult, "utf8"),
      );
    }
    let imageReceipt = null;
    const imageErrors = [];
    if (caseName === "image") {
      await cp(join(agent, "image-result.json"), report.files.image);
      imageReceipt = JSON.parse(await readFile(report.files.image, "utf8"));
      const expected = oracle.cases.image;
      if (
        imageReceipt.ok !== true ||
        imageReceipt.key !== expected.keys[0] ||
        imageReceipt.format !== expected.format ||
        !expected.provenance.includes(imageReceipt.provenance)
      )
        imageErrors.push("wrong Excerpt Image receipt");
      if (typeof imageReceipt.path !== "string")
        imageErrors.push("Excerpt Image receipt has no path");
      else {
        const bytes = await readFile(imageReceipt.path);
        if (
          !bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        )
          imageErrors.push("Excerpt Image is not a PNG");
      }
    }
    report.errors = validate(caseName, envelope, {
      runRoot: corpus,
      vaultPath: vault,
      itemEnvelope,
    });
    report.errors.push(...exportErrors);
    report.errors.push(...imageErrors);
    report.errors.push(
      ...checkAnswer(caseName, answer, {
        resultPath: report.files.result,
        envelope,
        imageReceipt,
      }),
    );
    if (itemCases.has(caseName) && report.metrics.itemQueryExitZero < 1)
      report.errors.push(
        "agent made no completed Item Query call with exit code zero",
      );
    if (!itemCases.has(caseName) && report.metrics.annotationQueryExitZero < 1)
      report.errors.push(
        "agent made no completed Annotation Query call with exit code zero",
      );
    if (mixedQueryCases.has(caseName) && report.metrics.itemQueryExitZero < 1)
      report.errors.push(
        "agent made no completed Item Query call with exit code zero",
      );
    if (caseName === "image" && report.metrics.imageExitZero < 1)
      report.errors.push(
        "agent made no completed Annotation Image call with exit code zero",
      );
    if (report.metrics.forbiddenReads.length)
      report.errors.push("agent read evaluator sources");
    report.state = report.errors.length ? "failed" : "passed";
    if (report.errors.length) report.failureKind = "task";
  } catch (error) {
    report.errors.push(error.message);
    if (!report.failureKind)
      report.failureKind = report.state === "agent" ? "agent" : "environment";
    report.state = "failed";
  } finally {
    let removed = true;
    if (vaultOpened) {
      const removal = await processRunner(
        process.execPath,
        [fixtureTool, "remove", vault, "--purge"],
        { cwd: repo, timeoutMs: 180_000 },
      ).catch((error) => ({ code: -1, stderr: error.message }));
      if (removal.code !== 0) {
        removed = false;
        report.errors.push(`vault cleanup failed: ${removal.stderr}`);
        report.state = "failed";
        report.failureKind ??= "environment";
        report.cleanupRequired = [vault, base, corpus];
      }
    }
    if (removed) {
      await rm(base, { recursive: true, force: true });
      await rm(corpus, { recursive: true, force: true });
    }
    await rm(agent, { recursive: true, force: true });
    await writeFile(
      report.files.check,
      `${JSON.stringify(
        {
          pass: report.errors.length === 0 && report.state === "passed",
          errors: report.errors,
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      report.files.report,
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }
  return report;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (!options) {
    console.log(
      "usage: node run.mjs <case> --model <model> --effort <low|medium|high|xhigh> [--timeout-minutes 10]",
    );
    return;
  }
  const controller = new AbortController();
  let interrupted = false;
  const onInterrupt = () => {
    interrupted = true;
    controller.abort();
  };
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onInterrupt);
  let report;
  try {
    report = await runCase(options, { signal: controller.signal });
  } finally {
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onInterrupt);
  }
  console.log(
    JSON.stringify(
      {
        state: report.state,
        failureKind: report.failureKind,
        errors: report.errors,
        metrics: report.metrics,
        report: report.files.report,
      },
      null,
      2,
    ),
  );
  if (interrupted) process.exitCode = 130;
  else if (report.state !== "passed") process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 2;
  });
