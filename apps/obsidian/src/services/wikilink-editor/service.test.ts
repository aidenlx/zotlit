import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { it } from "@effect/vitest";
import { Context, Effect, Exit, Layer, PubSub, Scope, Stream } from "effect";
import { MarkdownView, TFile } from "obsidian";
import type {
  App,
  Editor,
  Workspace as ObsidianWorkspace,
  WorkspaceLeaf,
} from "obsidian";
import { describe, expect } from "vitest";

import { layerHostApp } from "@/lib/__fixtures__/obsidian-host-app";
import { testPluginHost } from "@/lib/__fixtures__/plugin-host";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { ObsidianApp } from "@/lib/obsidian-app";
import { CitationLookup } from "@/services/citation-index/lookup-service";
import type { CitationLookupState } from "@/services/citation-index/lookup-service";
import { CitationPopover } from "@/services/citation-popover/service";
import { CitationText } from "@/services/citation-text/service";
import type { CitationTextEvent } from "@/services/citation-text/service";
import { CitekeyEditor } from "@/services/citekey-editor/service";
import { cache, createNoteHost } from "@/services/note-index/__fixtures__";
import { layerNoteIndex, NoteIndex } from "@/services/note-index/service";
import type { Settings } from "@/services/settings/schema";
import {
  layerPluginSettings,
  PluginSettings,
} from "@/services/settings/service";

import { layerWikilinkEditor } from "./service";

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
 * The Wikilink Editor over the real Note Index on a vault holding one
 * Literature Note, the real settings seeded with `overrides` before it starts,
 * and two open Markdown editors. Closing `scope` unloads it.
 */
const openEditor = Effect.fnUntraced(function* (
  overrides: Partial<Settings> = {},
) {
  const vault = createNoteHost(
    { "Doe 2024.md": cache({ itemKey: "DEE23456" }) },
    { enabledAtRuntime: true },
  );
  const base = yield* Layer.build(
    Layer.mergeAll(
      layerNoteIndex,
      layerPluginSettings({
        loadData: () => Promise.resolve(null),
        saveData: () => Promise.resolve(),
      }),
    ).pipe(Layer.provideMerge(layerHostApp(vault.app))),
  );
  const notes = Context.get(base, NoteIndex);
  const settings = Context.get(base, PluginSettings);
  yield* notes.whenIndexed;
  yield* settings.update(overrides);

  const extensions: Extension[][] = [];
  const host = testPluginHost({
    registerEditorExtension: (extension) => {
      if (Array.isArray(extension)) extensions.push(extension);
    },
  });
  const dispatched: string[] = [];
  let leafReads = 0;
  // The open editors the redraw reaches.
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
    layerWikilinkEditor.pipe(
      Layer.provide(
        Layer.mergeAll(
          host.layer,
          Layer.succeed(ObsidianApp, app),
          Layer.mock(CitekeyEditor, {}),
          Layer.mock(CitationText, { events: Stream.fromPubSub(text) }),
          Layer.mock(CitationLookup, {
            changes: Stream.fromPubSub(lookup),
            invalidated: Stream.fromPubSub(lookup).pipe(
              Stream.map(() => undefined),
            ),
          }),
          Layer.mock(CitationPopover, {}),
        ),
      ),
      Layer.provide(Layer.succeedContext(base)),
    ),
    scope,
  );
  yield* settle;
  return {
    settings,
    registered: () => extensions.at(-1)!,
    reconfigures: () => vault.workspace.reconfigures,
    dispatched,
    leafReads: () => leafReads,
    /** Gives the vault's one Literature Note another Item key, or none. */
    writeNote: (itemKey: string | undefined) =>
      Effect.gen(function* () {
        const file = vault.vault.files.get("Doe 2024.md")!;
        vault.metadataCache.change(file, cache({ itemKey }));
        yield* notes.whenSettled;
      }),
    emitText: (event: CitationTextEvent) => PubSub.publish(text, event),
    emitLookup: PubSub.publish(lookup, {
      status: "fresh",
      revision: "2",
      stopped: false,
    }),
    unload: Scope.close(scope, Exit.void),
  };
});

describe("WikilinkEditor registration", () => {
  it.effect(
    "installs the extension once so source settings can change live",
    () =>
      Effect.gen(function* () {
        const h = yield* openEditor({
          "citation.wikilink-citations": false,
          "citation.show-formatted": false,
        });

        expect(h.registered()).toHaveLength(1);
        expect(h.reconfigures()).toBe(1);

        yield* h.unload;
        expect(h.registered()).toEqual([]);
        expect(h.reconfigures()).toBe(2);
      }),
  );
});

describe("WikilinkEditor redraw", () => {
  it.effect("redraws every open editor when a Literature Note changes", () =>
    Effect.gen(function* () {
      const h = yield* openEditor();

      yield* h.writeNote("REE34567");
      yield* settle;

      expect(h.dispatched).toEqual(["note.md", "other.md"]);
    }),
  );

  it.effect("redraws when a gating setting changes", () =>
    Effect.gen(function* () {
      const h = yield* openEditor({ "citation.wikilink-citations": false });

      yield* h.settings.update({ "citation.wikilink-citations": true });
      yield* settle;
      expect(h.dispatched).toEqual(["note.md", "other.md"]);

      h.dispatched.length = 0;
      yield* h.settings.update({ "citation.show-formatted": false });
      yield* settle;
      expect(h.dispatched).toEqual(["note.md", "other.md"]);
    }),
  );

  it.effect("redraws when the Hover Action changes who answers a hover", () =>
    Effect.gen(function* () {
      const h = yield* openEditor();

      yield* h.settings.update({ "citation.hover-action": "off" });
      yield* settle;
      expect(h.dispatched).toEqual(["note.md", "other.md"]);

      // Which mode holds a hover back for a modifier is read at hover time, so
      // nothing drawn depends on it.
      h.dispatched.length = 0;
      yield* h.settings.update({
        "citation.hover-require-mod-live-preview": true,
      });
      yield* settle;
      expect(h.dispatched).toEqual([]);
    }),
  );

  it.effect("leaves lookup redraws to each open editor view", () =>
    Effect.gen(function* () {
      const h = yield* openEditor();

      yield* h.emitLookup;
      yield* settle;

      expect(h.leafReads()).toBe(0);
    }),
  );

  it.effect("leaves the editors alone when an unrelated setting changes", () =>
    Effect.gen(function* () {
      const h = yield* openEditor();

      yield* h.settings.update({ "citation.open-as-links": false });
      yield* settle;

      expect(h.dispatched).toEqual([]);
    }),
  );

  it.effect("redraws the one document whose citation text landed", () =>
    Effect.gen(function* () {
      const h = yield* openEditor();

      yield* h.emitText({ type: "changed", path: "note.md" });
      yield* settle;
      expect(h.dispatched).toEqual(["note.md"]);

      h.dispatched.length = 0;
      yield* h.emitText({ type: "invalidated" });
      yield* settle;
      expect(h.dispatched).toEqual(["note.md", "other.md"]);
    }),
  );

  it.effect(
    "leaves the editors alone when Wikilink Citations is off and formatted presentation changes",
    () =>
      Effect.gen(function* () {
        const h = yield* openEditor({ "citation.wikilink-citations": false });

        yield* h.settings.update({ "citation.show-formatted": false });
        yield* settle;

        expect(h.dispatched).toEqual([]);
      }),
  );
});
