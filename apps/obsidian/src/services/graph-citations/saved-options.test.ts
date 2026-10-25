import type { App, Workspace } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";

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
    return stubService<App>("App", {
      workspace: stubService<Workspace>("Workspace", {
        readWorkspaceFile: () => Promise.resolve(layout),
      }),
    });
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
    const workspace: Workspace = Object.create(null);
    const saved = await savedLeafOptions(
      stubService<App>("App", {
        workspace,
      }),
    );

    expect([...saved]).toEqual([]);
  });
});
