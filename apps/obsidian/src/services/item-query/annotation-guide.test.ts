import { Effect, Scheduler } from "effect";
import type { CliData } from "obsidian";
import { describe, expect, it } from "vitest";

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
import { QUERY_COMMAND } from "./contract";
import { decodeQuery } from "./decode";
import type { QueryReply } from "./worker-protocol";

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
});
