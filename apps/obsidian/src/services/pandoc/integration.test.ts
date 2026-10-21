import { describe, expect, it } from "vitest";

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

  it("returns the exact installed Pandoc Integration Pair in one response", () => {
    expect(JSON.parse(handlers[PANDOC_FILES_COMMAND]({}))).toEqual({
      contractVersion: 3,
      command: PANDOC_FILES_COMMAND,
      pluginVersion: PLUGIN_VERSION,
      files: {
        [PANDOC_FILTER_FILENAME]: pandocCliFilter,
        [PANDOC_DEFAULTS_FILENAME]: pandocDefaults,
      },
    });
  });

  it.each(PARAMETER_FREE_COMMANDS)("%s rejects parameters", (command) => {
    expect(() => handlers[command]({ unexpected: "true" })).toThrow(
      `Unknown parameter 'unexpected': ${command} takes no parameters.`,
    );
  });
});
