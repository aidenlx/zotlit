import type { Extension } from "@codemirror/state";
import { it } from "@effect/vitest";
import { Effect, Exit, Layer, Scope, Stream } from "effect";
import { TFile } from "obsidian";
import { describe, expect } from "vitest";

import { testEvent } from "@/lib/__fixtures__/event-stream";
import { MemoryWorkspace } from "@/lib/__fixtures__/obsidian-workspace";
import { testPluginHost } from "@/lib/__fixtures__/plugin-host";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import { layerWorkspaceFrom } from "@/lib/obsidian-workspace";
import { CitationLookup } from "@/services/citation-index/lookup-service";
import type { CitationLookupState } from "@/services/citation-index/lookup-service";
import { CitationPopover } from "@/services/citation-popover/service";
import { CitationText } from "@/services/citation-text/service";
import type { CitationTextEvent } from "@/services/citation-text/service";
import { CitekeyEditor } from "@/services/citekey-editor/service";
import { NoteIndex } from "@/services/note-index/service";
import type { NoteIndexChange } from "@/services/note-index/service";
import { settingsFeed } from "@/services/settings/__fixtures__";
import type { Settings } from "@/services/settings/schema";

import { layerWikilinkEditor } from "./service";

/**
 * The Wikilink Editor over settings seeded with `overrides`, and a workspace
 * with editors open on `note.md` and `other.md`. `unload` closes it.
 */
const openEditor = Effect.fnUntraced(function* (
  overrides: Partial<Settings> = {},
) {
  const settings = settingsFeed(overrides);
  const extensions: Extension[][] = [];
  const host = testPluginHost({
    registerEditorExtension: (extension) => {
      if (Array.isArray(extension)) extensions.push(extension);
    },
  });
  const workspace = new MemoryWorkspace();
  workspace.openMarkdownEditor("note.md");
  workspace.openMarkdownEditor("other.md");
  const notes = testEvent<NoteIndexChange>();
  const text = testEvent<CitationTextEvent>();
  const lookup = testEvent<CitationLookupState>();
  const scope = yield* Scope.make();
  yield* Layer.buildWithScope(
    layerWikilinkEditor.pipe(
      Layer.provide(
        Layer.mergeAll(
          host.layer,
          layerWorkspaceFrom(workspace),
          settings.layer,
          Layer.mock(MetadataCache, {}),
          Layer.mock(NoteIndex, { changes: notes.stream }),
          Layer.mock(CitekeyEditor, {}),
          Layer.mock(CitationText, { events: text.stream }),
          Layer.mock(CitationLookup, {
            changes: lookup.stream,
            invalidated: lookup.stream.pipe(Stream.map(() => undefined)),
          }),
          Layer.mock(CitationPopover, {}),
        ),
      ),
    ),
    scope,
  );
  return {
    settings,
    registered: () => extensions.at(-1)!,
    workspace,
    notes,
    text,
    lookup,
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
        expect(h.workspace.reconfigures).toBe(1);

        yield* h.unload;
        expect(h.registered()).toEqual([]);
        expect(h.workspace.reconfigures).toBe(2);
      }),
  );
});

describe("WikilinkEditor redraw", () => {
  it.effect("redraws every open editor when a Literature Note changes", () =>
    Effect.gen(function* () {
      const h = yield* openEditor();

      h.notes.emit({
        type: "changed",
        file: Object.assign(new TFile(), { path: "Doe 2024.md" }),
      });

      expect(h.workspace.dispatched).toEqual(["note.md", "other.md"]);
    }),
  );

  it.effect("redraws when a gating setting changes", () =>
    Effect.gen(function* () {
      const h = yield* openEditor({ "citation.wikilink-citations": false });

      h.settings.update({ "citation.wikilink-citations": true });
      expect(h.workspace.dispatched).toEqual(["note.md", "other.md"]);

      h.workspace.dispatched.length = 0;
      h.settings.update({ "citation.show-formatted": false });
      expect(h.workspace.dispatched).toEqual(["note.md", "other.md"]);
    }),
  );

  it.effect("redraws when the Hover Action changes who answers a hover", () =>
    Effect.gen(function* () {
      const h = yield* openEditor();

      h.settings.update({ "citation.hover-action": "off" });
      expect(h.workspace.dispatched).toEqual(["note.md", "other.md"]);

      // Which mode holds a hover back for a modifier is read at hover time, so
      // nothing drawn depends on it.
      h.workspace.dispatched.length = 0;
      h.settings.update({ "citation.hover-require-mod-live-preview": true });
      expect(h.workspace.dispatched).toEqual([]);
    }),
  );

  it.effect("leaves lookup redraws to each open editor view", () =>
    Effect.gen(function* () {
      const h = yield* openEditor();

      h.lookup.emit({ status: "fresh", revision: "2", stopped: false });

      expect(h.lookup.subscribers).toBe(0);
      expect(h.workspace.dispatched).toEqual([]);
    }),
  );

  it.effect("leaves the editors alone when an unrelated setting changes", () =>
    Effect.gen(function* () {
      const h = yield* openEditor();

      h.settings.update({ "citation.open-as-links": false });

      expect(h.workspace.dispatched).toEqual([]);
    }),
  );

  it.effect("redraws the one document whose citation text landed", () =>
    Effect.gen(function* () {
      const h = yield* openEditor();

      h.text.emit({ type: "changed", path: "note.md" });
      expect(h.workspace.dispatched).toEqual(["note.md"]);

      h.workspace.dispatched.length = 0;
      h.text.emit({ type: "invalidated" });
      expect(h.workspace.dispatched).toEqual(["note.md", "other.md"]);
    }),
  );

  it.effect(
    "leaves the editors alone when Wikilink Citations is off and formatted presentation changes",
    () =>
      Effect.gen(function* () {
        const h = yield* openEditor({ "citation.wikilink-citations": false });

        h.settings.update({ "citation.show-formatted": false });

        expect(h.workspace.dispatched).toEqual([]);
      }),
  );
});
