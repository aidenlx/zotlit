// A notes-table test host over the index and creation boundaries its tests drive.
import { Effect, Layer, Stream } from "effect";
import type { TFile } from "obsidian";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import { layerHost } from "@/lib/__fixtures__/obsidian-host-app";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { layerUnreadViewServices } from "@/lib/__fixtures__/view-atoms";
import { buildRuntime } from "@/lib/effect-layer";
import type { SubscriptionRuntime } from "@/lib/effect-stream";
import { Vault } from "@/lib/obsidian-vault";
import { Workspace } from "@/lib/obsidian-workspace";
import { DEFAULT_PROFILE } from "@/lib/profile-stamp";
import { makeViewRegistry } from "@/lib/view-atoms";
import type { NoteFeatureHandle } from "@/services/note-feature/operations";
import { NoteFeature } from "@/services/note-feature/service";
import type { buildNoteIndex } from "@/services/note-index/__fixtures__";
import { noteIndexSnapshotAtom } from "@/services/note-index/atoms";
import { NoteIndex } from "@/services/note-index/service";
import { Profile } from "@/services/profile/service";
import { Template } from "@/services/template/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import type { ZoteroPrefSnapshot } from "@/services/zotero-pref/service";
import { ZoteroReads } from "@/services/zotero-reads/service";
import { literatureNotes } from "@/views/query-view/table-notes";
import type { LiteratureNotesDeps } from "@/views/query-view/table-notes";
import { waitFor } from "@/views/template-data-explorer/__fixtures__";

export interface NotesHostDeps {
  runtime: SubscriptionRuntime;
  app: LiteratureNotesDeps["app"];
  noteIndex: ReturnType<typeof buildNoteIndex>;
  profile: { changed: Stream.Stream<void> };
  template: { "compile-status-changed": Stream.Stream<void> };
  zoteroReads: Pick<ZoteroReads["Service"], "reads">;
  noteFeature: Pick<
    NoteFeatureHandle,
    "replacedKeys" | "createNoteInteractively"
  >;  /** The vault's file at `path`, as the table resolves a note it keys by path. */
  getFile: (path: string) => TFile | null;
}

export async function makeNotesHost(deps: NotesHostDeps) {
  const stack = new AsyncDisposableStack();
  const notifier = testNotifier();
  const runtime = buildRuntime(
    Layer.mergeAll(
      layerUnreadViewServices,
      layerHost(),
      notifier.layer,
      Layer.mock(Workspace, {
        openLinkText: (link, source, options) =>
          Effect.promise(() =>
            deps.app.workspace.openLinkText(link, source, options?.newLeaf),
          ),
      }),
      Layer.succeed(NoteIndex, deps.noteIndex.runtime.runSync(NoteIndex)),
      Layer.mock(Vault, {
        getFileByPath: (path) => Effect.sync(() => deps.getFile(path)),
      }),
      Layer.mock(Profile, {
        changes: Stream.concat(Stream.make(null), deps.profile.changed).pipe(
          Stream.map(() => ({
            loaded: true,
            profiles: [],
            diagnostics: [],
            defaultDocumentPath: "",
            templateStatus: {
              state: "loaded" as const,
              compileErrors: new Map(),
            },
          })),
        ),
      }),
      Layer.mock(Template, {
        compileEvents: deps.template["compile-status-changed"],
      }),
      Layer.mock(ZoteroReads, {
        reads: stubService<ZoteroReads["Service"]["reads"]>("ZoteroReadsApi", {
          ItemsByIndexedKeys: (request) =>
            deps.zoteroReads.reads.ItemsByIndexedKeys(request),
        }),
      }),
      Layer.mock(ZoteroPref, {
        current: Effect.succeed(
          stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", {
            dataDir: "",
          }),
        ),
      }),
      Layer.mock(NoteFeature, {
        replacedKeys: (file) =>
          Effect.promise(() => deps.noteFeature.replacedKeys(file)),
        planCreations: (keys) =>
          Effect.succeed(
            new Map(
              keys.map((key) => [
                key,
                {
                  item: undefined,
                  selection: {
                    source: "bound" as const,
                    selector: DEFAULT_PROFILE,
                    shouldAsk: false,
                  },
                  previews: [],
                },
              ]),
            ),
          ),
        createNote: (item) =>
          Effect.promise(async () => {
            const file = await deps.noteFeature.createNoteInteractively(item);
            return file
              ? { outcome: "created" as const, file }
              : {
                  outcome: "refused" as const,
                  diagnostic: {
                    code: "literature-note-exists" as const,
                    hint: "",
                    indexedKey: item.indexedKey,
                    paths: ["cancelled.md"] as [string],
                  },
                };
          }),
      }),
    ),
    stack,
  );
  const registry = makeViewRegistry(await runtime.context(), { idleTTL: 0 });
  stack.defer(registry.mount(noteIndexSnapshotAtom));
  await waitFor(() => {
    if (!registry.get(noteIndexSnapshotAtom).ready)
      throw new Error("Note Index snapshot pending");
  });
  const notes = literatureNotes({
    app: deps.app,
    registry,
    creation: {
      app: deps.app,
      createProfile: () => Effect.undefined,
      importProfile: () => Effect.undefined,
    },
  });
  stack.defer(notes.on("changed", () => {}));
  return {
    notes,
    registry,
    async [Symbol.asyncDispose]() {
      registry.dispose();
      await stack.disposeAsync();
    },
  };
}
