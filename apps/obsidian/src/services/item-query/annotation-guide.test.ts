import { Effect, Scheduler } from "effect";
import type { CliData, Plugin } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { ItemQueryDatabase } from "@zotlit/db/item-query";
import { openScenarioDatabase } from '@zotlit/db/test-scenario';
import type { ScenarioDatabase } from '@zotlit/db/test-scenario';
import { ItemQueryScheduler } from "@zotlit/item-query";

import { MY_LIBRARY_SCOPE } from "@/services/library-scope/scope";

import {
  ANNOTATION_GUIDE_EXAMPLES,
  ANNOTATION_GUIDE_FILTERS,
  ANNOTATION_GUIDE_TOPICS,
  ANNOTATION_GUIDE_TOPIC_NAMES,
} from "./annotation-guide";
import {
  ANNOTATION_QUERY_GUIDE_COMMAND,
  annotationQueryGuideHandler,
  answerItemQuery,
  registerItemQueryCli,
} from "./cli";
import { decodeAnnotationQuery } from "./decode";
import type { QueryReply } from "./worker-protocol";

const IDENTITY = {
  vault: { name: "Research", path: "/vaults/research" },
  source: { id: "source-1", databasePath: "/zotero/zotero.sqlite" },
};

function runAnnotationQuery(
  scenario: ScenarioDatabase,
  params: CliData,
): Promise<Record<string, unknown>> {
  const decoded = decodeAnnotationQuery(params);
  if ("code" in decoded)
    throw new Error(`Malformed guide query: ${decoded.message}`);
  const answer = answerItemQuery(
    { identity: IDENTITY, scope: MY_LIBRARY_SCOPE },
    decoded,
  ).pipe(
    Effect.scoped,
    Effect.provideService(ItemQueryDatabase, { client: scenario.db }),
    Effect.provideService(Scheduler.Scheduler, new ItemQueryScheduler()),
    Effect.map((reply: QueryReply) => JSON.parse(reply.answer)),
  );
  return Effect.runPromise(answer);
}

describe("zotlit:annotation-query-guide", () => {
  it("prints its quickstart, commands, and complete topic index", () => {
    const output = annotationQueryGuideHandler({});

    expect(() => JSON.parse(output)).toThrow();
    expect(output).toContain("zotlit:annotation-query");
    expect(output).toContain("zotlit:annotation-query-guide");
    for (const topic of ANNOTATION_GUIDE_TOPIC_NAMES)
      expect(output).toContain(topic);
  });

  it.each([
    ["command", ["SYNOPSIS", "Library scope", "libraries wins"]],
    ["filter", ["item.title", "tags.contains", "one expression"]],
    ["keys", ["attachmentIndexedKey", "itemIndexedKey", "combine with AND"]],
    ["fields", ["position.kind", "unknown", "attachment"]],
    ["sort", ["Sortable Fields", "Sort Index", "truncated"]],
    ["results", ["diagnostic.hint", "file.bytes", "returnedCount"]],
    ["images", ["hasExcerptImage", "provenance", "file-unavailable"]],
    ["cancel", ["cancelRequested", "query-id", "annotations-1"]],
  ])("prints topic=%s", (topic, facts) => {
    const output = annotationQueryGuideHandler({ topic });

    expect(facts.filter((fact) => !output.includes(fact))).toEqual([]);
  });

  it("states document location conventions once", () => {
    const guide = Object.values(ANNOTATION_GUIDE_TOPICS).join("\n");

    for (const text of ["bottom-left origin", "zero-based", "document's own"])
      expect(guide.split(text)).toHaveLength(2);
  });

  it("answers an unknown topic with the guide command diagnostic", () => {
    expect(
      JSON.parse(annotationQueryGuideHandler({ topic: "bogus" })),
    ).toMatchObject({
      command: ANNOTATION_QUERY_GUIDE_COMMAND,
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
      if (!answer.ok) failures.push({ args, answer });
    }
    for (const filter of ANNOTATION_GUIDE_FILTERS) {
      const answer = await runAnnotationQuery(scenario, {
        filter,
        fields: "[]",
      });
      if (!answer.ok) failures.push({ filter, answer });
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

    registerItemQueryCli(plugin, {
      annotations: async () => "",
      answer: async () => "",
      cancel: () => false,
      schema: async () => "",
    });

    expect(registerCliHandler).toHaveBeenCalledWith(
      ANNOTATION_QUERY_GUIDE_COMMAND,
      expect.any(String),
      expect.objectContaining({ topic: expect.any(Object) }),
      annotationQueryGuideHandler,
    );
  });
});
