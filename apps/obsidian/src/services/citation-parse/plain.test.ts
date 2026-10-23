import { expect, vi } from "vitest";

import { Effect } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";

import { makeParseHarness } from "./__fixtures__";
import { ParseFailed } from "./client";

vi.mock("virtual:citation-parse-worker", () => ({ default: "" }));

it.effect(
  "rejects a parse with the domain error after the whole runtime is disposed (#1705)",
  () =>
    Effect.gen(function* () {
      const { runtime, parser } = yield* makeParseHarness();
      yield* runtime.disposeEffect;
      yield* Effect.promise(() =>
        expect(
          parser.parse(
            { path: "draft.md", generation: 1, text: "" },
            new AbortController().signal,
          ),
        ).rejects.toBeInstanceOf(ParseFailed),
      );
    }),
);
