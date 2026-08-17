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
      contractVersion: 2,
      command: PANDOC_FILES_COMMAND,
      pluginVersion: PLUGIN_VERSION,
      files: {
        [PANDOC_FILTER_FILENAME]: pandocCliFilter,
        [PANDOC_DEFAULTS_FILENAME]: pandocDefaults,
      },
    });
  });

  it("reports the complete focused Native Pandoc Workflow contract", () => {
    const guide = handlers[PANDOC_GUIDE_COMMAND]({});

    expect(guide).toContain(`ZotLit ${PLUGIN_VERSION}`);
    expect(guide).toContain(`obsidian-cli ${PANDOC_FILES_COMMAND}`);
    expect(guide).toContain(PANDOC_FILTER_FILENAME);
    expect(guide).toContain(PANDOC_DEFAULTS_FILENAME);
    expect(guide).toContain("keep both files together");
    expect(guide).toContain("obsidian-cli zotlit:resolve file=");
    expect(guide).toContain('"citations"');
    expect(guide).toContain('"errors"');
    expect(guide).toContain("file-not-found");
    expect(guide).toContain("database-unavailable");
    expect(guide).toContain("item-not-found");
    expect(guide).toContain("citation-key-missing");
    expect(guide).toContain("duplicate-citation-key");
    expect(guide).toContain("unresolved-citation-intent");
    expect(guide).toContain("zotlit-csl:");
    expect(guide).toContain("obsidian-cli zotlit:csl style=");
    expect(guide).toContain('"path"');
    expect(guide).toContain("style-missing");
    expect(guide).toContain("parent-missing");
    expect(guide).toContain("style-unreadable");
    expect(guide).toContain("style-invalid");
    expect(guide).toContain("csl-write-failed");
    expect(guide).toContain("csl-ambiguous");
    expect(guide).toContain("Refresh");
    expect(guide).toContain("Pandoc 3.1.1 or newer");
    expect(guide).toContain("Obsidian 1.13.4 or newer");
    expect(guide).toContain("Obsidian installer 1.12.7 or newer");
    expect(guide).toContain("Better BibTeX");
    expect(guide).toContain("Zotero CSL JSON export");
    expect(guide).toContain("--defaults");
    expect(guide).toContain("--bibliography");
    expect(guide).toContain("--fail-if-warnings");
  });

  it.each(PARAMETER_FREE_COMMANDS)("%s rejects parameters", (command) => {
    expect(() => handlers[command]({ unexpected: "true" })).toThrow(
      `${command} accepts no parameters`,
    );
  });
});
