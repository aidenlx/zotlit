import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";

import {
  pandocCliFilter,
  pandocDefaults,
  PANDOC_DEFAULTS_FILENAME,
  PANDOC_FILTER_FILENAME,
} from "./filter";
import {
  createPandocIntegrationHandlers,
  PANDOC_FILES_COMMAND,
  PANDOC_GUIDE_COMMAND,
} from "./integration";

const PLUGIN_VERSION = "2.0.1-test";
const PARAMETER_FREE_COMMANDS = [
  PANDOC_FILES_COMMAND,
  PANDOC_GUIDE_COMMAND,
] as const;

describe("Pandoc integration CLI", () => {
  const handlers = createPandocIntegrationHandlers(PLUGIN_VERSION);

  it.effect(
    "returns the exact installed Pandoc Integration Pair in one response",
    () =>
      Effect.gen(function* () {
        expect(JSON.parse(yield* handlers[PANDOC_FILES_COMMAND]({}))).toEqual({
          contractVersion: 3,
          command: PANDOC_FILES_COMMAND,
          pluginVersion: PLUGIN_VERSION,
          files: {
            [PANDOC_FILTER_FILENAME]: pandocCliFilter,
            [PANDOC_DEFAULTS_FILENAME]: pandocDefaults,
          },
        });
      }),
  );

  it.effect.each(PARAMETER_FREE_COMMANDS)("%s rejects parameters", (command) =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        handlers[command]({ unexpected: "true" }),
      );
      expect(error).toBeInstanceOf(TypeError);
      expect(error).toHaveProperty(
        "message",
        `Unknown parameter 'unexpected': ${command} takes no parameters.`,
      );
    }),
  );
});
