// @vitest-environment happy-dom
// A Query File embed shows one view of the file in a note, with `this` bound
// to the note's Item. These tests drive it as Obsidian does: the creator, the
// component it returns added to the note and loaded, and the file's text on
// disk changing under it.
import { resetMockPlatform, setMockPlatform } from "@mock/obsidian";
import type { App, EmbedContext } from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";

import { createObsidianHost } from "@/lib/__fixtures__/obsidian-host";
import type {
  QueryViewOutcome,
  QueryViewRequest,
} from "@/services/item-query/query-view";

import { createQueryFileEmbed } from "./embed";
import type { QueryFileEmbed } from "./embed";
import { parseQueryFile } from "./query-file";
import type { QueryViewDeps } from "./view";

vi.mock("zustand", () => import("../__fixtures__/zustand"));

const FILE_PATH = "query-files/Reading.zotquery";
const FILE = `views:
  - type: annotations
    name: Yellow
    from: annotations
    filters: colorName == "yellow"
  - type: annotations
    name: Mine
    from: annotations
    filters: item == this.item
`;
const NOTE = `---
zotero-key: RUGIER24
---
![[Reading.zotquery]]
`;

const EMPTY: QueryViewOutcome = {
  kind: "result",
  result: {
    libraries: [{ type: "personal" }],
    query: {} as never,
    returnedCount: 0,
    matchedCount: 0,
    truncated: false,
    warnings: [],
    rows: [],
  },
};

let cleanup = new DisposableStack();
afterEach(() => {
  cleanup.dispose();
  cleanup = new DisposableStack();
  document.body.replaceChildren();
});

function setup() {
  setMockPlatform({ isMacOS: true });
  cleanup.defer(resetMockPlatform);
  const host = createObsidianHost({
    [FILE_PATH]: FILE,
    "notes/Lab.md": NOTE,
    "notes/Plain.md": "No properties\n",
  });
  const app = {
    ...host.app,
    scope: undefined,
    workspace: { ...host.workspace, getLeaf: vi.fn() },
  } as unknown as App;
  const run = vi.fn((_request: QueryViewRequest, _signal: AbortSignal) =>
    Promise.resolve(EMPTY),
  );
  const off = () => () => {};
  const deps = {
    app,
    reads: { on: off },
    libraryScope: { on: off },
    query: { run },
    annotations: {
      on: off,
      hold: () => ({ [Symbol.dispose]: () => {} }),
    },
  } as unknown as QueryViewDeps;

  /** Embed the Query File in `sourcePath` as Obsidian does, and load it. */
  async function embed(
    sourcePath: string,
    subpath = "",
  ): Promise<{ embed: QueryFileEmbed; el: HTMLElement }> {
    const el = document.createElement("div");
    document.body.append(el);
    const context: EmbedContext = {
      app,
      containerEl: el,
      linktext: `Reading.zotquery${subpath}`,
      sourcePath,
      depth: 1,
    };
    const component = createQueryFileEmbed(deps)(
      context,
      host.file(FILE_PATH),
      subpath,
    );
    await act(async () => {
      component.load();
      await component.loadFile();
      await component.query.settled;
    });
    cleanup.defer(() => act(() => component.unload()));
    return { embed: component, el };
  }
  return { host, run, embed };
}

const viewName = (el: HTMLElement) =>
  el.querySelector("[data-query-view-menu]")?.textContent;

it("shows the first view, or the view the link names", async () => {
  const { embed, run } = setup();
  const plain = await embed("notes/Lab.md");
  expect(viewName(plain.el)).toBe("Yellow");
  const named = await embed("notes/Lab.md", "#Mine");
  expect(viewName(named.el)).toBe("Mine");
  expect(run.mock.calls.at(-1)![0].filter).toBe("item == this.item");
});

it("binds `this.item` to the Item of the embedding note", async () => {
  const { embed, run } = setup();
  await embed("notes/Lab.md", "#Mine");
  expect(run.mock.calls.at(-1)![0].context).toEqual({ item: "RUGIER24" });
  await embed("notes/Plain.md", "#Mine");
  expect(run.mock.calls.at(-1)![0].context).toBeUndefined();
});

it("keeps a click inside it from selecting the embed in Live Preview", async () => {
  const { embed } = setup();
  const { el } = await embed("notes/Lab.md");
  expect(el.classList.contains("interactive-child")).toBe(true);
});

it("saves a toolbar change to the file, and another embed of it follows", async () => {
  const { embed, host } = setup();
  const first = await embed("notes/Lab.md");
  const second = await embed("notes/Plain.md");

  const file = parseQueryFile(FILE);
  const [yellow, mine] = file.views;
  await act(async () => {
    first.embed.query.commit({
      ...file,
      views: [{ ...yellow!, name: "Yellow ones" }, mine!],
    });
    await first.embed.flush();
  });

  expect(host.text(FILE_PATH)).toContain("name: Yellow ones");
  expect(viewName(first.el)).toBe("Yellow ones");
  await act(async () => {
    await second.embed.query.settled;
  });
  expect(viewName(second.el)).toBe("Yellow ones");
});

it("saves through an open tab of the file, so the tab shows the change", async () => {
  const { embed, host } = setup();
  const tab = host.openInEditor(host.file(FILE_PATH));
  const { embed: component } = await embed("notes/Lab.md");
  const file = parseQueryFile(FILE);
  await act(async () => {
    component.query.commit({ ...file, views: [...file.views].reverse() });
    await component.flush();
  });
  expect(tab.getViewData().indexOf("name: Mine")).toBeLessThan(
    tab.getViewData().indexOf("name: Yellow"),
  );
  expect(host.text(FILE_PATH)).toBe(tab.getViewData());
});
