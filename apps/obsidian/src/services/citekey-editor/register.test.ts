import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { it } from "@effect/vitest";
import { Context, Effect, Exit, Layer, PubSub, Scope, Stream } from "effect";
import { MarkdownView, TFile } from "obsidian";
import type {
  App,
  Editor,
  HoverLinkSource,
  Workspace as ObsidianWorkspace,
  WorkspaceLeaf,
} from "obsidian";
import { describe, expect } from "vitest";

import { MemoryWorkspace } from "@/lib/__fixtures__/obsidian-workspace";
import { testPluginHost } from "@/lib/__fixtures__/plugin-host";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { ObsidianApp } from "@/lib/obsidian-app";
import { layerWorkspaceFrom } from "@/lib/obsidian-workspace";
import { AnnotationPopover } from "@/services/annotation-popover/service";
import { CitationLookup } from "@/services/citation-index/lookup-service";
import type { CitationLookupState } from "@/services/citation-index/lookup-service";
import { CitationPopover } from "@/services/citation-popover/service";
import { CitationText } from "@/services/citation-text/service";
import type { CitationTextEvent } from "@/services/citation-text/service";
import { CITEKEY_HOVER_SOURCE } from "@/services/citekey-navigation";
import type { Settings } from "@/services/settings/schema";
import {
  layerPluginSettings,
  PluginSettings,
} from "@/services/settings/service";

import { layerCitekeyEditorExtension } from "./register";
import { CitekeyEditor } from "./service";

/** The markdown leaves two notes are open in, as the workspace hands them out. */
function leaves(dispatched: string[]): WorkspaceLeaf[] {
  return ["note.md", "other.md"].map((path) => {
    const file = new TFile();
    file.path = path;
    const view = stubService<MarkdownView>("MarkdownView", {
      file,
      editor: stubService<Editor>("Editor", {
        cm: stubService<EditorView>("EditorView", {
          dispatch: () => dispatched.push(path),
        }),
      }),
    });
    // The redraw narrows a leaf's view with `instanceof`.
    Object.setPrototypeOf(view, MarkdownView.prototype);
    return stubService<WorkspaceLeaf>("WorkspaceLeaf", { view });
  });
}

/** Lets the layer's Stream consumers take what was just published. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 5; turn++) yield* Effect.yieldNow;
});

/**
 * The extension registration over the real settings, seeded with `overrides`
 * before it starts, an in-memory workspace, and two open Markdown editors.
 * Closing `scope` unloads it.
 */
const openExtension = Effect.fnUntraced(function* (
  overrides: Partial<Settings> = {},
) {
  const settingsContext = yield* Layer.build(
    layerPluginSettings({
      loadData: () => Promise.resolve(null),
      saveData: () => Promise.resolve(),
    }),
  );
  const settings = Context.get(settingsContext, PluginSettings);
  yield* settings.update(overrides);

  const extensions: Extension[][] = [];
  const sources: Record<string, HoverLinkSource> = {};
  const host = testPluginHost({
    registerEditorExtension: (extension) => {
      if (Array.isArray(extension)) extensions.push(extension);
    },
    registerHoverLinkSource: (id, info) => {
      sources[id] = info;
    },
  });
  const workspace = new MemoryWorkspace();
  const dispatched: string[] = [];
  let leafReads = 0;
  const app = stubService<App>("App", {
    workspace: stubService<ObsidianWorkspace>("Workspace", {
      getLeavesOfType: (type: string) => {
        if (type === "markdown") leafReads += 1;
        return leaves(dispatched);
      },
    }),
  });
  const text = yield* PubSub.unbounded<CitationTextEvent>();
  const lookup = yield* PubSub.unbounded<CitationLookupState>();
  const scope = yield* Scope.make();
  yield* Layer.buildWithScope(
    layerCitekeyEditorExtension.pipe(
      Layer.provide(
        Layer.mergeAll(
          host.layer,
          Layer.succeed(ObsidianApp, app),
          layerWorkspaceFrom(workspace),
          Layer.succeedContext(settingsContext),
          Layer.mock(CitekeyEditor, {}),
          Layer.mock(CitationText, { events: Stream.fromPubSub(text) }),
          Layer.mock(CitationLookup, {
            changes: Stream.fromPubSub(lookup),
            invalidated: Stream.fromPubSub(lookup).pipe(
              Stream.map(() => undefined),
            ),
          }),
          Layer.mock(CitationPopover, {}),
          Layer.mock(AnnotationPopover, {}),
        ),
      ),
    ),
    scope,
  );
  yield* settle;
  return {
    settings,
    /** The switchable extension array: the last registration. */
    registered: () => extensions.at(-1)!,
    sources,
    workspace,
    dispatched,
    leafReads: () => leafReads,
    emitText: (event: CitationTextEvent) => PubSub.publish(text, event),
    emitLookup: PubSub.publish(lookup, {
      status: "fresh",
      revision: "2",
      stopped: false,
    }),
    unload: Scope.close(scope, Exit.void),
  };
});

describe("CitekeyEditor extension settings lifecycle", () => {
  it.effect(
    "registers the extension while formatting or navigation is enabled",
    () =>
      Effect.gen(function* () {
        const h = yield* openExtension({
          "citation.show-formatted": false,
          "citation.open-as-links": false,
        });
        expect(h.registered()).toEqual([]);

        yield* h.settings.update({ "citation.show-formatted": true });
        yield* settle;
        expect(h.registered()).toHaveLength(1);

        yield* h.settings.update({ "citation.open-as-links": true });
        yield* settle;
        expect(h.registered()).toHaveLength(1);
        expect(h.workspace.reconfigures).toBe(1);

        yield* h.settings.update({ "citation.show-formatted": false });
        yield* settle;
        expect(h.registered()).toHaveLength(1);

        yield* h.settings.update({ "citation.open-as-links": false });
        yield* settle;
        expect(h.registered()).toEqual([]);

        yield* h.settings.update({ "citation.show-formatted": true });
        yield* settle;
        yield* h.unload;
        expect(h.registered()).toEqual([]);
      }),
  );

  it.effect(
    "stays off while Pandoc citations are off, whatever the editor toggle says",
    () =>
      Effect.gen(function* () {
        const h = yield* openExtension({
          "citation.pandoc-citations": false,
          "citation.open-as-links": true,
        });
        expect(h.registered()).toEqual([]);

        yield* h.settings.update({ "citation.pandoc-citations": true });
        yield* settle;
        expect(h.registered()).toHaveLength(1);

        yield* h.settings.update({ "citation.pandoc-citations": false });
        yield* settle;
        expect(h.registered()).toEqual([]);
      }),
  );
});

describe("CitekeyEditor hover source", () => {
  it.effect(
    "registers one Mod-gated hover-link source for every citekey surface",
    () =>
      Effect.gen(function* () {
        const { sources } = yield* openExtension();

        expect(Object.keys(sources)).toEqual([CITEKEY_HOVER_SOURCE]);
        // Mod is the platform convention, and this row is the Page preview
        // plugin's own gate on the Page preview Hover action.
        expect(sources[CITEKEY_HOVER_SOURCE]?.defaultMod).toBe(true);
        expect(sources[CITEKEY_HOVER_SOURCE]?.display).toBeTruthy();
      }),
  );
});

describe("CitekeyEditor lookup ownership", () => {
  it.effect("leaves lookup redraws to each open editor view", () =>
    Effect.gen(function* () {
      const h = yield* openExtension();

      yield* h.emitLookup;
      yield* settle;

      expect(h.leafReads()).toBe(0);
    }),
  );
});

describe("CitekeyEditor citation text broadcast", () => {
  it.effect(
    "redraws only the editors showing the document whose text changed",
    () =>
      Effect.gen(function* () {
        const h = yield* openExtension();

        yield* h.emitText({ type: "changed", path: "note.md" });
        yield* settle;

        expect(h.dispatched).toEqual(["note.md"]);
      }),
  );

  it.effect("redraws every editor when all citation text goes stale", () =>
    Effect.gen(function* () {
      const h = yield* openExtension();

      yield* h.emitText({ type: "invalidated" });
      yield* settle;

      expect(h.dispatched).toEqual(["note.md", "other.md"]);
    }),
  );
});
