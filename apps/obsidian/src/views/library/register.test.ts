// @vitest-environment happy-dom
// Where the first screen opens the Library View: never over the note the
// researcher has open.
import type { App } from "obsidian";
import { describe, expect, it } from "vitest";

import { openLibraryView } from "./register";

/** A leaf showing a view of `type`, recording the view states it is given. */
function leaf(name: string, type: string) {
  const states: unknown[] = [];
  return {
    name,
    states,
    view: { getViewType: () => type },
    setViewState: (state: unknown) => {
      states.push(state);
      return Promise.resolve();
    },
  };
}

/** A workspace whose active leaf is `active`, with the Library View in `library`, if any. */
function workspace({
  active,
  library,
}: {
  active: ReturnType<typeof leaf>;
  library?: ReturnType<typeof leaf>;
}) {
  const tab = leaf("new tab", "empty");
  const app = {
    workspace: {
      getLeavesOfType: (type: string) =>
        type === "zotlit-library" && library ? [library] : [],
      getMostRecentLeaf: () => active,
      getLeaf: (pane?: unknown) => (pane === "tab" ? tab : active),
      setActiveLeaf: () => {},
      revealLeaf: () => Promise.resolve(),
    },
  } as unknown as App;
  return { app, tab };
}

/** The leaf the first screen opened the Library View in, if any. */
async function opened(
  app: App,
  leaves: ReturnType<typeof leaf>[],
): Promise<string[]> {
  await openLibraryView(app, { pane: "first-screen" });
  return leaves
    .filter((candidate) => candidate.states.length > 0)
    .map((candidate) => candidate.name);
}

describe("the first screen", () => {
  it("opens the Library View in the active leaf while it is empty", async () => {
    const active = leaf("empty leaf", "empty");
    const { app, tab } = workspace({ active });
    expect(await opened(app, [active, tab])).toEqual(["empty leaf"]);
  });

  it("opens the Library View in a new tab, leaving the open note in its leaf", async () => {
    const active = leaf("note", "markdown");
    const { app, tab } = workspace({ active });
    expect(await opened(app, [active, tab])).toEqual(["new tab"]);
  });

  it("reuses an open Library View, opening nothing new", async () => {
    const active = leaf("note", "markdown");
    const library = leaf("library", "zotlit-library");
    const { app, tab } = workspace({ active, library });
    expect(await opened(app, [active, tab, library])).toEqual([]);
  });
});
