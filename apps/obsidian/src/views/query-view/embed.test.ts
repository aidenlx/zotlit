// @vitest-environment happy-dom
// A Query File embed shows one view of the file in a note, with `this` bound
// to the note's Item. These tests drive it as Obsidian does: the creator, the
// component it returns added to the note and loaded, and the file's text on
// disk changing under it.
import { resetMockPlatform, setMockPlatform } from "@mock/obsidian";
import { delay } from "@std/async";
import type { App, EmbedContext, Scope } from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createObsidianHost } from "@/lib/__fixtures__/obsidian-host";
import type {
  QueryViewOutcome,
  QueryViewRequest,
} from "@/services/item-query/query-view";

import { QueryCardFocus } from "./card-focus";
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
  /** The keymap's pushed Scopes, the last one on top. */
  const scopes: Scope[] = [];
  const app = {
    ...host.app,
    scope: undefined,
    keymap: {
      pushScope: (scope: Scope) => scopes.push(scope),
      popScope: (scope: Scope) => {
        const index = scopes.indexOf(scope);
        if (index !== -1) scopes.splice(index, 1);
      },
    },
    workspace: { ...host.workspace, getLeaf: vi.fn() },
  } as unknown as App;
  const cardFocus = new QueryCardFocus(app);
  const run = vi.fn((_request: QueryViewRequest, _signal: AbortSignal) =>
    Promise.resolve(EMPTY),
  );
  const off = () => () => {};
  const deps = {
    app,
    reads: { on: off },
    libraryScope: { on: off },
    query: { run },
    cardFocus,
    annotations: {
      on: off,
      hold: () => ({ [Symbol.dispose]: () => {} }),
    },
  } as unknown as QueryViewDeps;

  /**
   * Embed the Query File in `sourcePath` as Obsidian does, and load it. With
   * `wait: "load"` it waits for `loadFile` alone, as Export to PDF does.
   */
  async function embed(
    sourcePath: string,
    subpath = "",
    { wait = "settled" }: { wait?: "settled" | "load" } = {},
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
      if (wait === "settled") await component.query.settled;
    });
    cleanup.defer(() => act(() => component.unload()));
    return { embed: component, el };
  }
  return { host, run, embed, scopes, cardFocus };
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

it("settles its load once the first rows show, as Export to PDF waits for it", async () => {
  const { embed, run } = setup();
  const answer = Promise.withResolvers<QueryViewOutcome>();
  run.mockReturnValueOnce(answer.promise);
  let loaded = false;
  const shown = embed("notes/Lab.md", "", { wait: "load" }).then((result) => {
    loaded = true;
    return result;
  });
  await delay(50);
  expect(run).toHaveBeenCalled();
  expect(loaded).toBe(false);
  answer.resolve(EMPTY);
  const { el } = await shown;
  expect(el.querySelector("[data-query-empty]")).not.toBeNull();
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

it("keeps a drag that starts in it from the note's editor, which would drag the embed's link", async () => {
  const { embed } = setup();
  const note = document.body.createDiv();
  const { el } = await embed("notes/Lab.md");
  note.append(el);
  const editorDrag = vi.fn();
  note.addEventListener("dragstart", editorDrag);
  const handle = el.createEl("a", { attr: { draggable: "true" } });

  handle.dispatchEvent(new DragEvent("dragstart", { bubbles: true }));
  expect(editorDrag).not.toHaveBeenCalled();
});

describe("the card keys", () => {
  /** A control in the embed that takes focus as a card does, and is no text field. */
  const control = (el: HTMLElement) => {
    const button = el.querySelector("button");
    if (!button) throw new Error("The embed shows no button");
    return button;
  };

  it("are on the keymap while focus is in the embed, and leave with focus to the note", async () => {
    const { embed, scopes } = setup();
    const { el } = await embed("notes/Lab.md");
    const note = document.body.createEl("textarea");

    control(el).focus();
    expect(scopes).toHaveLength(1);
    note.focus();
    expect(scopes).toEqual([]);
  });

  it("stay off the keymap while focus is in a text field of the embed", async () => {
    const { embed, scopes } = setup();
    const { el } = await embed("notes/Lab.md");
    const field = el.createEl("input", { type: "text" });

    field.focus();
    expect(scopes).toEqual([]);
  });

  it("leave the keymap when the embed unloads with focus in it", async () => {
    const { embed, scopes } = setup();
    const { embed: component, el } = await embed("notes/Lab.md");

    control(el).focus();
    await act(() => component.unload());
    expect(scopes).toEqual([]);
  });

  it("let the palette step the embed focus was last in, through a modal over it", async () => {
    const { embed, cardFocus } = setup();
    const note = document.body.createDiv();
    const { embed: component, el } = await embed("notes/Lab.md");
    note.append(el);
    const palette = document.body
      .createDiv({ cls: "modal-container" })
      .createEl("input");

    expect(cardFocus.surfaceIn(note)).toBeNull();
    control(el).focus();
    palette.focus();
    expect(cardFocus.surfaceIn(note)).toBe(component.query);

    control(el).focus();
    note.createEl("textarea").focus();
    expect(cardFocus.surfaceIn(note)).toBeNull();
  });
});
