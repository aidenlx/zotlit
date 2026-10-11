import { Effect, Scheduler } from "effect";
import type { CliData, Plugin } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { ItemQueryDatabase } from "@zotlit/db/item-query";
import { openScenarioDatabase } from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";
import { ItemQueryScheduler } from "@zotlit/item-query";

import { MY_LIBRARY_SCOPE } from "@/services/library-scope/scope";

import {
  ANNOTATION_GUIDE_EXAMPLES,
  ANNOTATION_GUIDE_FILTERS,
} from "./annotation-guide";
import { answer } from "./answer";
import { guideHandler, registerQueryCli } from "./cli";
import { QUERY_COMMAND, QUERY_GUIDE_COMMAND } from "./contract";
import { decodeQuery } from "./decode";
import { GUIDE_TOPICS, GUIDE_TOPIC_NAMES } from "./guide";
import type { QueryReply } from "./worker-protocol";

const annotationQueryGuideHandler = guideHandler;

const IDENTITY = {
  vault: { name: "Research", path: "/vaults/research" },
  source: { id: "source-1", databasePath: "/zotero/zotero.sqlite" },
};

function runAnnotationQuery(
  scenario: ScenarioDatabase,
  params: CliData,
): Promise<Record<string, unknown>> {
  const decoded = decodeQuery({ ...params, from: "annotations" });
  if (decoded.kind === "invalid")
    throw new Error(`Malformed guide query: ${decoded.message}`);
  const reply = answer(
    {
      schema: false,
      dataset: "annotations",
      command: QUERY_COMMAND,
      query: decoded.value,
      scope: MY_LIBRARY_SCOPE,
    },
    { identity: IDENTITY },
  ).pipe(
    Effect.scoped,
    Effect.provideService(ItemQueryDatabase, { client: scenario.db }),
    Effect.provideService(Scheduler.Scheduler, new ItemQueryScheduler()),
    Effect.map((reply: QueryReply) => JSON.parse(reply.answer)),
  );
  return Effect.runPromise(reply);
}

describe("zotlit:query-guide", () => {
  it("prints its quickstart, commands, and complete topic index", () => {
    const output = annotationQueryGuideHandler({});

    expect(() => JSON.parse(output)).toThrow();
    expect(output).toContain("zotlit:query");
    expect(output).toContain("zotlit:query-guide");
    for (const topic of GUIDE_TOPIC_NAMES) expect(output).toContain(topic);
  });

  it.each([
    ["datasets", ["from=items", "from=annotations", "item."]],
    ["filter", ["item.title", "tags.contains", "one expression"]],
    [
      "filter",
      [
        "attachmentIndexedKey",
        "itemIndexedKey",
        "&& to combine conditions",
        "Query Warning",
        "item.indexedKey",
      ],
    ],
    ["fields", ["position.kind", "unknown", "attachment"]],
    ["sort", ["Sortable Fields", "Sort Index", "truncated"]],
    [
      "results",
      [
        "diagnostic.report",
        "diagnostic.hint",
        "warnings",
        "version is 3",
        "file.bytes",
        "returnedCount",
      ],
    ],
    ["fields", ["hasExcerptImage", "provenance", "file-unavailable"]],
    ["cancel", ["cancelRequested", "query-id", "annotations-1"]],
  ])("prints topic=%s", (topic, facts) => {
    const output = annotationQueryGuideHandler({ topic });

    expect(facts.filter((fact) => !output.includes(fact))).toEqual([]);
  });

  it("states document location conventions once", () => {
    const guide = Object.values(GUIDE_TOPICS).join("\n");

    for (const text of ["bottom-left origin", "zero-based", "document's own"])
      expect(guide.split(text)).toHaveLength(2);
  });

  it("answers an unknown topic with the guide command diagnostic", () => {
    expect(
      JSON.parse(annotationQueryGuideHandler({ topic: "bogus" })),
    ).toMatchObject({
      command: QUERY_GUIDE_COMMAND,
      ok: false,
      diagnostic: {
        code: "invalid-argument",
        details: { parameter: "topic" },
      },
    });
  });

  it("shows only query examples and Filter Expressions that execute", async () => {
    using scenario = openScenarioDatabase({ annotations: true });
    const failures: object[] = [];

    for (const args of ANNOTATION_GUIDE_EXAMPLES) {
      const answer = await runAnnotationQuery(scenario, args);
      if (
        !answer.ok ||
        !Array.isArray(answer.warnings) ||
        answer.warnings.length > 0
      )
        failures.push({ args, answer });
    }
    for (const filter of ANNOTATION_GUIDE_FILTERS) {
      const answer = await runAnnotationQuery(scenario, {
        filter,
        fields: "[]",
      });
      if (
        !answer.ok ||
        !Array.isArray(answer.warnings) ||
        answer.warnings.length > 0
      )
        failures.push({ filter, answer });
    }

    expect(ANNOTATION_GUIDE_EXAMPLES.length).toBeGreaterThan(0);
    expect(ANNOTATION_GUIDE_FILTERS.length).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  });

  it("registers the guide command with its topic flag", () => {
    const registerCliHandler = vi.fn();
    const plugin = {
      register: vi.fn(),
      registerCliHandler,
    } as unknown as Plugin;

    registerQueryCli(plugin, {
      query: async () => "",
      cancel: () => false,
      schema: async () => "",
      values: async () => "",
    });

    expect(registerCliHandler).toHaveBeenCalledWith(
      QUERY_GUIDE_COMMAND,
      expect.any(String),
      expect.objectContaining({ topic: expect.any(Object) }),
      expect.any(Function),
    );
    const guide = registerCliHandler.mock.calls.find(
      ([command]) => command === QUERY_GUIDE_COMMAND,
    )![3] as (params: CliData) => string;
    expect(guide({ topic: "fields" })).toBe(
      annotationQueryGuideHandler({ topic: "fields" }),
    );
  });
});

it("teaches two-way Relation Lists, nested navigation, and fixed record summaries", () => {
  expect(GUIDE_TOPICS.datasets).toContain("through attachments");
  expect(GUIDE_TOPICS.datasets).toContain("Sort Index");
  expect(GUIDE_TOPICS.filter).toContain(
    'attachments.filter(value.contentType == "application/pdf" && value.exists).isEmpty()',
  );
  expect(GUIDE_TOPICS.filter).toContain(
    'value.annotations.filter(value.color == "#ffd400")',
  );
  expect(GUIDE_TOPICS.fields).toContain("attachments[].annotations[].text");
  expect(GUIDE_TOPICS.fields).toContain(
    "Item: indexedKey, title, citationKey.",
  );
  expect(GUIDE_TOPICS.fields).toContain(
    "Annotation: indexedKey, type, text, comment, pageLabel, pageIndex.",
  );
});
