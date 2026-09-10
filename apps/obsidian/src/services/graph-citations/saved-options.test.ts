import type { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { savedLeafOptions } from "./saved-options";

vi.mock("@/lib/log", () => ({
  getLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe("savedLeafOptions", () => {
  function appWith(layout: unknown): App {
    return {
      workspace: { readWorkspaceFile: () => Promise.resolve(layout) },
    } as unknown as App;
  }

  it("reads every graph leaf's options out of the nested layout, by leaf id", async () => {
    const saved = await savedLeafOptions(
      appWith({
        main: {
          type: "split",
          children: [
            {
              type: "tabs",
              children: [
                {
                  id: "local-1",
                  type: "leaf",
                  state: {
                    type: "localgraph",
                    state: { options: { "zotlit-pandoc-citations": false } },
                  },
                },
                {
                  id: "note-1",
                  type: "leaf",
                  state: { type: "markdown", state: { file: "Draft.md" } },
                },
              ],
            },
          ],
        },
        right: {
          id: "global-1",
          type: "leaf",
          state: { type: "graph", state: { options: { showTags: true } } },
        },
      }),
    );

    expect([...saved]).toEqual([
      ["local-1", { "zotlit-pandoc-citations": false }],
      ["global-1", { showTags: true }],
    ]);
  });

  it("answers an empty map when the build moved the reader", async () => {
    const saved = await savedLeafOptions({ workspace: {} } as unknown as App);

    expect([...saved]).toEqual([]);
  });
});
