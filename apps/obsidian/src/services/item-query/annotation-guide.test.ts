import type { CliData } from "obsidian";
import { describe, expect } from "vitest";

import { ItemQueryDatabase } from "@zotlit/db/item-query";
import { openScenarioDatabase } from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";
import { ItemQueryScheduler } from "@zotlit/item-query";

import { Effect, Scheduler } from "@/lib/effect";
import { acquireDisposable } from "@/lib/effect-scope";
import { it } from "@/lib/effect-vitest";
import { MY_LIBRARY_SCOPE } from "@/services/library-scope/scope";

import {
  ANNOTATION_GUIDE_EXAMPLES,
  ANNOTATION_GUIDE_FILTERS,
} from "./annotation-guide";
import { answer } from "./answer";
import { QUERY_COMMAND } from "./contract";
import { decodeQuery } from "./decode";

const IDENTITY = {
  vault: { name: "Research", path: "/vaults/research" },
  source: { id: "source-1", databasePath: "/zotero/zotero.sqlite" },
};

/** The parsed answer of an Annotation query; a malformed one fails with its rejection. */
function runAnnotationQuery(scenario: ScenarioDatabase, params: CliData) {
  return decodeQuery({ ...params, from: "annotations" }).pipe(
    Effect.flatMap((decoded) =>
      answer(
        {
          schema: false,
          dataset: "annotations",
          command: QUERY_COMMAND,
          query: decoded,
          scope: MY_LIBRARY_SCOPE,
        },
        { identity: IDENTITY },
      ),
    ),
    Effect.scoped,
    Effect.provideService(ItemQueryDatabase, { client: scenario.db }),
    Effect.provideService(Scheduler.Scheduler, new ItemQueryScheduler()),
    Effect.map((reply) => JSON.parse(reply.answer) as Record<string, unknown>),
  );
}

describe("zotlit:query-guide", () => {
  it.effect(
    "shows only query examples and Filter Expressions that execute",
    () =>
      Effect.gen(function* () {
        const scenario = yield* acquireDisposable(() =>
          openScenarioDatabase({ annotations: true }),
        );
        const failures: object[] = [];

        for (const args of ANNOTATION_GUIDE_EXAMPLES) {
          const answer = yield* runAnnotationQuery(scenario, args);
          if (
            !answer.ok ||
            !Array.isArray(answer.warnings) ||
            answer.warnings.length > 0
          )
            failures.push({ args, answer });
        }
        for (const filter of ANNOTATION_GUIDE_FILTERS) {
          const answer = yield* runAnnotationQuery(scenario, {
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
      }),
  );
});
