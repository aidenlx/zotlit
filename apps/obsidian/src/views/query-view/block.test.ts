// @vitest-environment happy-dom
// A Query Block in Export to PDF: Obsidian waits for the promise each code
// block processor returns before it prints, so the block's processor settles
// once the first rows show.
import { resetMockPlatform, setMockPlatform } from "@mock/obsidian";
import { delay } from "@std/async";
import type {
  App,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
} from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";

import { createObsidianHost } from "@/lib/__fixtures__/obsidian-host";
import type {
  QueryViewOutcome,
  QueryViewRequest,
} from "@/services/item-query/query-view";

import { registerQueryBlock } from "./block";
import { QueryCardFocus } from "./card-focus";
import type { QueryViewDeps } from "./view";

vi.mock("zustand", () => import("../__fixtures__/zustand"));

const SOURCE = `views:
  - type: annotations
    name: Yellow
    from: annotations
    filters: colorName == "yellow"`;

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

it("settles its processor once the first rows show, as Export to PDF waits for it", async () => {
  setMockPlatform({ isMacOS: true });
  cleanup.defer(resetMockPlatform);
  const host = createObsidianHost({ "notes/Lab.md": "No properties\n" });
  const app = {
    ...host.app,
    scope: undefined,
    keymap: { pushScope: () => {}, popScope: () => {} },
  } as unknown as App;
  const answer = Promise.withResolvers<QueryViewOutcome>();
  const run = vi.fn(
    (_request: QueryViewRequest, _signal: AbortSignal) => answer.promise,
  );
  const off = () => () => {};
  const deps = {
    app,
    reads: { on: off },
    libraryScope: { on: off },
    query: { run },
    cardFocus: new QueryCardFocus(app),
    annotations: { on: off, hold: () => ({ [Symbol.dispose]: () => {} }) },
  } as unknown as QueryViewDeps;
  type Plugin = Parameters<typeof registerQueryBlock>[0];
  type Processor = Parameters<Plugin["registerMarkdownCodeBlockProcessor"]>[1];
  let processor: Processor | undefined;
  const plugin: Plugin = {
    registerMarkdownCodeBlockProcessor: (_language, handler) => {
      processor = handler;
      return {} as never;
    },
  };
  registerQueryBlock(plugin, deps);

  // As in a print: the block has no section to save to.
  const el = document.body.createDiv({ cls: "print" }).createDiv();
  const ctx = {
    sourcePath: "notes/Lab.md",
    getSectionInfo: () => null,
    addChild: (child: MarkdownRenderChild) => {
      child.load();
      cleanup.defer(() => child.unload());
    },
  } as unknown as MarkdownPostProcessorContext;
  let printed = false;
  await act(async () => {
    void Promise.resolve(processor!(SOURCE, el, ctx)).then(() => {
      printed = true;
    });
    await delay(50);
  });
  expect(run).toHaveBeenCalled();
  expect(printed).toBe(false);

  await act(async () => {
    answer.resolve(EMPTY);
    await delay(50);
  });
  // The list draws the rows once the render settles.
  await delay(0);
  expect(printed).toBe(true);
  expect(el.querySelector("[data-query-empty]")).not.toBeNull();
});
