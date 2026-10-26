// A Query File embed shows one view of the file in a note. These tests drive
// it as Obsidian does: the creator, the component it returns added to the note
// and loaded, and the file's text on disk changing under it. What it shares
// with the Query Block is in `note-host.test.ts`.
import { resetMockPlatform, setMockPlatform } from "@mock/obsidian";
import { Stream } from "effect";
import type { App, EmbedContext } from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";

import { createObsidianHost } from "@/lib/__fixtures__/obsidian-host";
import { testRuntime } from "@/lib/__fixtures__/runtime";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { effectBridge } from "@/lib/effect-bridge";
import type {
  QueryViewOutcome,
  QueryViewRequest,
} from "@/services/item-query/query-view";
import { annotationReads } from "@/services/pdf-annotation-editor/__fixtures__";
import { fakeQuery } from "@/views/query-view/__fixtures__/query-run";

// @vitest-environment happy-dom
import { makeQueryHost } from "./__fixtures__/host";
import { noLiteratureNotes } from "./__fixtures__/literature-notes";
import { openTextFileView } from "./__fixtures__/open-text-view";
import { QueryCardFocus } from "./card-focus";
import { createQueryFileEmbed } from "./embed";
import type { QueryView, QueryViewDeps } from "./view";

vi.mock("zustand", () => import("@/views/__fixtures__/zustand"));

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
    query: { filter: null, fields: [], sort: [], limit: null },
    returnedCount: 0,
    matchedCount: 0,
    truncated: false,
    warnings: [],
    rows: [],
  },
};

let cleanup = new AsyncDisposableStack();
afterEach(async () => {
  await cleanup.disposeAsync();
  cleanup = new AsyncDisposableStack();
  document.body.replaceChildren();
});

async function setup() {
  setMockPlatform({ isMacOS: true });
  cleanup.defer(resetMockPlatform);
  const host = createObsidianHost({
    [FILE_PATH]: FILE,
    "notes/Lab.md": NOTE,
    "notes/Plain.md": "No properties\n",
  });
  const app = stubService<App>("App", {
    vault: host.vault as unknown as App["vault"],
    metadataCache: host.metadataCache as unknown as App["metadataCache"],
    workspace: Object.assign(host.workspace, {
      getLeaf: vi.fn(),
    }) as unknown as App["workspace"],
    scope: stubService<App["scope"]>("Scope", {}),
    keymap: stubService<App["keymap"]>("Keymap", {
      pushScope: () => {},
      popScope: () => {},
    }),
  });
  const run = vi.fn((_request: QueryViewRequest, _signal: AbortSignal) =>
    Promise.resolve(EMPTY),
  );
  const runtime = testRuntime();
  const queryHost = cleanup.use(await makeQueryHost());
  const deps = stubService<QueryViewDeps>("QueryViewDeps", {
    registry: queryHost.registry,
    runtime,
    bridge: effectBridge(runtime),
    app,
    reads: stubService<QueryViewDeps["reads"]>("ZoteroReads", {
      changed: Stream.empty,
      degraded: Stream.empty,
      "refresh-failed": Stream.empty,
      refreshing: Stream.empty,
      "db-file-missing": Stream.empty,
      "refresh-requested": Stream.empty,
    }),
    libraryScope: stubService<QueryViewDeps["libraryScope"]>("LibraryScope", {
      changed: Stream.empty,
      "libraries-changed": Stream.empty,
    }),
    query: fakeQuery(run),
    cardFocus: new QueryCardFocus(app),
    annotations: stubService<QueryViewDeps["annotations"]>(
      "Annotations",
      annotationReads(),
    ),
    opener: stubService<QueryViewDeps["opener"]>("TargetOpener", {}),
    allowEditing: vi.fn(),
    reportBlockedGesture: vi.fn(),
    libraryTagNames: async () => [],
    zoteroPref: stubService<QueryViewDeps["zoteroPref"]>("ZoteroPref", {
      dataDir: "/Zotero",
      baseAttachmentPath: null,
    }),
    excerptDisplay: stubService<QueryViewDeps["excerptDisplay"]>(
      "ExcerptDisplay",
      { open: vi.fn(), refresh: vi.fn() },
    ),
    noteFeature: stubService<QueryViewDeps["noteFeature"]>(
      "NoteFeatureHandle",
      {},
    ),
    literatureNotes: noLiteratureNotes(),
  });

  /** Embed the Query File in `sourcePath` as Obsidian does, and load it. */
  async function embed(
    sourcePath: string,
    subpath = "",
  ): Promise<{ el: HTMLElement; view: QueryView }> {
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
      await viewOf(el).settled;
    });
    cleanup.defer(() => act(() => component.unload()));
    return { el, view: viewOf(el) };
  }

  /** Embed the Query File in a template's note preview, and load it. */
  async function preview(subpath = ""): Promise<HTMLElement> {
    const draft = document.body.createDiv();
    draft.dataset["zotlitDraft"] = "";
    const el = draft.createDiv();
    const component = createQueryFileEmbed(deps)(
      {
        app,
        containerEl: el,
        linktext: `Reading.zotquery${subpath}`,
        sourcePath: "notes/Lab.md",
        depth: 1,
      },
      host.file(FILE_PATH),
      subpath,
    );
    await act(async () => {
      component.load();
      await component.loadFile();
    });
    cleanup.defer(() => act(() => component.unload()));
    return el;
  }
  return { host, run, embed, preview };
}

/** The Query View the End-to-end Run reads from the embed's element. */
const viewOf = (el: HTMLElement): QueryView =>
  (el as HTMLElement & { zotlitQueryView: QueryView }).zotlitQueryView;

const viewName = (el: HTMLElement) =>
  el.querySelector("[data-query-view-menu]")?.textContent;

it("shows the first view, or the view the link names", async () => {
  const { embed, run } = await setup();
  const plain = await embed("notes/Lab.md");
  expect(viewName(plain.el)).toBe("Yellow");
  const named = await embed("notes/Lab.md", "#Mine");
  expect(viewName(named.el)).toBe("Mine");
  expect(run.mock.calls.at(-1)![0].filter).toBe("item == this.item");
});

it("shows a placeholder named after the file in a note preview", async () => {
  const { preview, run } = await setup();
  const plain = await preview();
  expect(
    plain.querySelector("[data-query-placeholder]")?.textContent,
  ).toContain("Reading");
  expect(viewOf(plain)).toBeUndefined();
  expect(plain.querySelector('[role="toolbar"]')).toBeNull();
  const named = await preview("#Mine");
  expect(named.textContent).toContain("Reading › Mine");
  expect(run).not.toHaveBeenCalled();
});

it("saves through an open tab of the file, so the tab shows the change", async () => {
  const { embed, host } = await setup();
  const tab = openTextFileView(host, host.file(FILE_PATH));
  const { view } = await embed("notes/Lab.md");
  await act(async () => {
    view.document.moveView(1, 0);
    await view.flush();
  });
  expect(tab.getViewData().indexOf("name: Mine")).toBeLessThan(
    tab.getViewData().indexOf("name: Yellow"),
  );
  expect(host.text(FILE_PATH)).toBe(tab.getViewData());
});
