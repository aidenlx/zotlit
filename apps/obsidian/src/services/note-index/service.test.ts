import type { App, CachedMetadata, TFile } from "obsidian";
import { describe, expect } from "vitest";

import { Effect } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";
import type { ProfileId } from "@/lib/profile-stamp";

import { makeHarness, startup, cache, paths, makeFile } from "./__fixtures__";
import { isLiteratureNote, resolveIndexedKey } from "./service";

const ITEM_A = "ABCD2345";
const ITEM_B = "ZZZ99999";

it.effect(
  "returns Literature and Imported Notes separately by Profile ID, following stamp edits",
  () =>
    Effect.gen(function* () {
      const profile = "Bk3Qn7XvT2Lp" as ProfileId;
      const { service, metadataCache, vault } = yield* makeHarness(
        {
          "Book.md": {
            frontmatter: {
              "zotero-key": ITEM_A,
              "zotlit-profile": `Old label (${profile})`,
            },
          },
          "Import.md": {
            frontmatter: {
              "zotero-note-key": ITEM_B,
              "zotlit-profile": profile,
            },
          },
          "Default.md": { frontmatter: { "zotero-key": "DFLT2345" } },
          "Scratch.md": { frontmatter: { "zotlit-profile": profile } },
          "Unknown.md": {
            frontmatter: {
              "zotero-key": "UNKN2345",
              "zotlit-profile": "unrecognized",
            },
          },
        },
        { enabledAtRuntime: true },
      );
      const notes = service.getNotesByProfile(profile);
      expect(paths(notes.literatureNotes)).toEqual(["Book.md"]);
      expect(paths(notes.importedNotes)).toEqual(["Import.md"]);
      expect(
        paths(service.getNotesByProfile("default").literatureNotes),
      ).toEqual(["Default.md"]);
      metadataCache.change(vault.files.get("Book.md")!, {
        frontmatter: { "zotero-key": ITEM_A },
      });
      expect(service.getNotesByProfile(profile).literatureNotes).toEqual([]);
      expect(
        paths(service.getNotesByProfile("default").literatureNotes).sort(),
      ).toEqual(["Book.md", "Default.md"]);
    }),
);

describe("NoteIndex", () => {
  it.effect("runs the Full Scan at once when enabled at runtime", () =>
    Effect.gen(function* () {
      const { service } = yield* makeHarness(
        {
          "paper.md": cache({ itemKey: ITEM_A }),
        },
        { enabledAtRuntime: true },
      );

      expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual(["paper.md"]);
    }),
  );

  it.effect("waits for cache completion when loaded during startup", () =>
    Effect.gen(function* () {
      const { metadataCache, workspace, service, vault } = yield* makeHarness(
        {
          "paper.md": cache({ itemKey: ITEM_A }),
        },
        { enabledAtRuntime: false },
      );

      expect(service.getNotesByItemKey(ITEM_A)).toEqual([]);

      startup({ metadataCache, workspace, vault });

      expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual(["paper.md"]);
    }),
  );

  it.effect(
    "says indexed, not changed for each note, once the Full Scan has read the notes the cache held at startup",
    () =>
      Effect.gen(function* () {
        const { metadataCache, workspace, service, vault } = yield* makeHarness(
          { "paper.md": cache({ itemKey: ITEM_A }) },
          { enabledAtRuntime: false },
        );
        const heard: string[] = [];
        service.on("changed", (file) => heard.push(`changed ${file.path}`));
        service.on("indexed", () => heard.push("indexed"));
        startup({ metadataCache, workspace, vault });
        // The whole index changed, not one file.
        expect(heard).toEqual(["indexed"]);
      }),
  );

  it.effect("whenIndexed resolves immediately once the Full Scan has run", () =>
    Effect.gen(function* () {
      const { service } = yield* makeHarness(
        { "paper.md": cache({ itemKey: ITEM_A }) },
        { enabledAtRuntime: true },
      );

      yield* Effect.promise(() =>
        expect(service.whenIndexed()).resolves.toBeUndefined(),
      );
    }),
  );

  it.effect(
    "whenIndexed waits for the Full Scan when loaded during startup",
    () =>
      Effect.gen(function* () {
        const { metadataCache, workspace, service, vault } = yield* makeHarness(
          { "paper.md": cache({ itemKey: ITEM_A }) },
          { enabledAtRuntime: false },
        );

        let settled = false;
        const gate = service.whenIndexed().then(() => {
          settled = true;
        });
        expect(settled).toBe(false);

        startup({ metadataCache, workspace, vault });
        yield* Effect.promise(() => gate);
        expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual(["paper.md"]);
      }),
  );

  it.effect(
    "tells its consumers when the Full Scan has indexed the notes",
    () =>
      Effect.gen(function* () {
        const { metadataCache, workspace, service, vault } = yield* makeHarness(
          { "paper.md": cache({ itemKey: ITEM_A }) },
          { enabledAtRuntime: false },
        );
        const seen: string[][] = [];
        service.on("indexed", () =>
          seen.push(paths(service.getNotesByItemKey(ITEM_A))),
        );

        startup({ metadataCache, workspace, vault });

        expect(seen).toEqual([["paper.md"]]);
      }),
  );

  it.effect(
    "keeps per-file mappings when the cache resolves again after the Full Scan",
    () =>
      Effect.gen(function* () {
        const { metadataCache, workspace, service, vault } = yield* makeHarness(
          {
            "paper.md": cache({ itemKey: ITEM_A }),
          },
        );
        startup({ metadataCache, workspace, vault });

        // A rescan would read this silent cache swap; the per-file path never sees it.
        metadataCache.setCache("paper.md", cache({ itemKey: ITEM_B }));
        metadataCache.resolve();

        expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual(["paper.md"]);
        expect(service.getNotesByItemKey(ITEM_B)).toEqual([]);
      }),
  );

  it.effect("updates indices and emits changed for metadata edits", () =>
    Effect.gen(function* () {
      const { service, vault, metadataCache, workspace } = yield* makeHarness({
        "paper.md": cache({}),
      });
      startup({ metadataCache, workspace, vault });
      const changed: string[] = [];
      service.on("changed", (file) => changed.push(file.path));

      metadataCache.change(
        vault.files.get("paper.md")!,
        cache({ itemKey: ITEM_A }),
      );

      expect(changed).toEqual(["paper.md"]);
      expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual(["paper.md"]);
    }),
  );

  it.effect("does not emit changed for no-op metadata updates", () =>
    Effect.gen(function* () {
      const { service, vault, metadataCache, workspace } = yield* makeHarness({
        "paper.md": cache({ itemKey: ITEM_A }),
      });
      startup({ metadataCache, workspace, vault });
      const changed: string[] = [];
      service.on("changed", (file) => changed.push(file.path));

      metadataCache.change(
        vault.files.get("paper.md")!,
        cache({ itemKey: ITEM_A }),
      );

      expect(changed).toEqual([]);
    }),
  );

  it.effect(
    "emits frontmatter-changed for any frontmatter edit of a tracked note, beside changed for its Indexed Key",
    () =>
      Effect.gen(function* () {
        const { service, vault, metadataCache } = yield* makeHarness(
          {
            "paper.md": cache({
              itemKey: ITEM_A,
              properties: { status: "new" },
            }),
            "Import.md": { frontmatter: { "zotero-note-key": ITEM_B } },
          },
          { enabledAtRuntime: true },
        );
        const changed: string[] = [];
        const frontmatter: string[] = [];
        service.on("changed", (file) => changed.push(file.path));
        service.on("frontmatter-changed", (file) =>
          frontmatter.push(file.path),
        );

        metadataCache.change(
          vault.files.get("paper.md")!,
          cache({ itemKey: ITEM_A, properties: { status: "read" } }),
        );
        metadataCache.change(vault.files.get("Import.md")!, {
          frontmatter: { "zotero-note-key": ITEM_B, rating: 3 },
        } as CachedMetadata);
        expect(frontmatter).toEqual(["paper.md", "Import.md"]);
        expect(changed).toEqual([]);

        metadataCache.change(
          vault.files.get("paper.md")!,
          cache({ itemKey: ITEM_B, properties: { status: "read" } }),
        );
        expect(frontmatter).toEqual(["paper.md", "Import.md", "paper.md"]);
        expect(changed).toEqual(["paper.md"]);
      }),
  );

  it.effect(
    "emits no frontmatter-changed for an edit that leaves the frontmatter as it was, or for an untracked note",
    () =>
      Effect.gen(function* () {
        const { service, vault, metadataCache } = yield* makeHarness(
          {
            "paper.md": cache({
              itemKey: ITEM_A,
              properties: { status: "new" },
            }),
            "scratch.md": cache({ properties: { status: "new" } }),
          },
          { enabledAtRuntime: true },
        );
        const frontmatter: string[] = [];
        service.on("frontmatter-changed", (file) =>
          frontmatter.push(file.path),
        );

        // A body edit: the cache is new, its frontmatter the same.
        metadataCache.change(
          vault.files.get("paper.md")!,
          cache({ itemKey: ITEM_A, properties: { status: "new" } }),
        );
        metadataCache.change(
          vault.files.get("scratch.md")!,
          cache({ properties: { status: "read" } }),
        );

        expect(frontmatter).toEqual([]);
      }),
  );

  it.effect(
    "lists the property names of the Literature Notes but the reserved and system keys, following edits",
    () =>
      Effect.gen(function* () {
        const { service, vault, metadataCache } = yield* makeHarness(
          {
            "a.md": cache({
              itemKey: ITEM_A,
              properties: {
                status: "read",
                tags: ["x"],
                aliases: ["y"],
                cssclasses: ["z"],
                "zotlit-profile": "default",
                "zotero-lastmod": "2026-01-01",
                "zotlit-csl": "apa",
                rating: 3,
              },
            }),
            "b.md": cache({
              itemKey: ITEM_B,
              properties: { "Reading status": 1 },
            }),
            "Import.md": {
              frontmatter: { "zotero-note-key": "NOTE2345", imported: true },
            } as CachedMetadata,
            "scratch.md": cache({ properties: { draft: true } }),
          },
          { enabledAtRuntime: true },
        );

        expect(service.getPropertyNames()).toEqual([
          "rating",
          "Reading status",
          "status",
        ]);

        metadataCache.change(
          vault.files.get("b.md")!,
          cache({ itemKey: ITEM_B, properties: { priority: "high" } }),
        );
        expect(service.getPropertyNames()).toEqual([
          "priority",
          "rating",
          "status",
        ]);
      }),
  );

  it.effect("moves a file from the old item key to the new item key", () =>
    Effect.gen(function* () {
      const { service, vault, metadataCache, workspace } = yield* makeHarness({
        "paper.md": cache({ itemKey: ITEM_A }),
      });
      startup({ metadataCache, workspace, vault });

      metadataCache.change(
        vault.files.get("paper.md")!,
        cache({ itemKey: ITEM_B }),
      );

      expect(service.getNotesByItemKey(ITEM_A)).toEqual([]);
      expect(paths(service.getNotesByItemKey(ITEM_B))).toEqual(["paper.md"]);
    }),
  );

  it.effect(
    "scans once on resolved when the build has no clean-cache hook",
    () =>
      Effect.gen(function* () {
        const { service, metadataCache, workspace, vault } = yield* makeHarness(
          { "paper.md": cache({ itemKey: ITEM_A }) },
          { cleanCacheHook: false },
        );
        const gate = service.whenIndexed();

        metadataCache.watchVault(vault);
        workspace.ready();
        expect(service.getIndexedItemKeys()).toEqual([]);
        metadataCache.resolve();

        yield* Effect.promise(() => expect(gate).resolves.toBeUndefined());
        expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual(["paper.md"]);

        // A later `resolved` finds no listener: the silent swap stays unseen.
        metadataCache.setCache("paper.md", cache({ itemKey: ITEM_B }));
        metadataCache.resolve();
        expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual(["paper.md"]);
      }),
  );

  it.effect(
    "whenIndexed settles when the service is disposed before the Full Scan",
    () =>
      Effect.gen(function* () {
        const { service, close } = yield* makeHarness({
          "paper.md": cache({ itemKey: ITEM_A }),
        });
        const gate = service.whenIndexed();

        yield* Effect.promise(() => close());

        yield* Effect.promise(() => expect(gate).resolves.toBeUndefined());
      }),
  );

  it.effect("whenIndexed settles on an empty vault", () =>
    Effect.gen(function* () {
      const { service, metadataCache, workspace, vault } = yield* makeHarness(
        {},
      );

      startup({ metadataCache, workspace, vault });

      yield* Effect.promise(() =>
        expect(service.whenIndexed()).resolves.toBeUndefined(),
      );
      expect(service.getIndexedItemKeys()).toEqual([]);
    }),
  );

  it.effect("orders shared-key notes by mtime descending, then path", () =>
    Effect.gen(function* () {
      const { service, vault, metadataCache, workspace } = yield* makeHarness({
        "old.md": cache({ itemKey: ITEM_A }),
        "new.md": cache({ itemKey: ITEM_A }),
        "tie-b.md": cache({ itemKey: ITEM_A }),
        "tie-a.md": cache({ itemKey: ITEM_A }),
      });
      vault.files.get("old.md")!.stat.mtime = 100;
      vault.files.get("new.md")!.stat.mtime = 200;
      // tie-a.md and tie-b.md keep the default mtime 0 → path breaks the tie.
      startup({ metadataCache, workspace, vault });

      expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual([
        "new.md",
        "old.md",
        "tie-a.md",
        "tie-b.md",
      ]);
    }),
  );

  it.effect("drops the item index on delete", () =>
    Effect.gen(function* () {
      const { service, vault, metadataCache, workspace } = yield* makeHarness({
        "paper.md": cache({ itemKey: ITEM_A }),
      });
      startup({ metadataCache, workspace, vault });

      vault.deleteFile("paper.md");

      expect(service.getNotesByItemKey(ITEM_A)).toEqual([]);
    }),
  );

  it.effect("checks literature notes from frontmatter only", () =>
    Effect.gen(function* () {
      const { app, vault } = yield* makeHarness({
        "paper.md": cache({ itemKey: ITEM_A }),
        "invalid.md": cache({ itemKey: "INVALID" }),
      });

      expect(isLiteratureNote(vault.files.get("paper.md")!, app)).toBe(true);
      expect(isLiteratureNote("paper.md", app)).toBe(true);
      expect(isLiteratureNote("invalid.md", app)).toBe(false);
    }),
  );

  it("resolves a linkpath to the Indexed Key of the Literature Note it points at", () => {
    const notes = new Map([
      ["Doe 2024.md", cache({ itemKey: ITEM_A })],
      ["Ordinary.md", cache({})],
    ]);
    // Exact-path resolution; enough to tell a hit from a dangling link.
    const app = {
      metadataCache: {
        getFirstLinkpathDest: (linkpath: string) =>
          notes.has(`${linkpath}.md`) ? makeFile(`${linkpath}.md`) : null,
        getFileCache: (file: TFile) => notes.get(file.path) ?? null,
      },
    } as unknown as App;

    expect(resolveIndexedKey("Doe 2024", "source.md", app)).toBe(ITEM_A);
    expect(resolveIndexedKey("Ordinary", "source.md", app)).toBeNull();
    expect(resolveIndexedKey("Missing", "source.md", app)).toBeNull();
  });
});

/**
 * Obsidian hears a rename in vault listener order. A plugin loaded during
 * startup subscribes before the metadata cache and hears it before the cache
 * rekeys the path; a plugin enabled at runtime subscribes after.
 */
describe.each([
  { load: "during startup", enabledAtRuntime: false },
  { load: "at runtime", enabledAtRuntime: true },
])("NoteIndex after a rename, loaded $load", ({ enabledAtRuntime }) => {
  const loaded = Effect.fn("fixture.loaded")(function* (
    files: Record<string, CachedMetadata>,
  ) {
    const harness = yield* makeHarness(files, { enabledAtRuntime });
    if (!enabledAtRuntime) startup(harness);
    const changed: string[] = [];
    harness.service.on("changed", (file) => changed.push(file.path));
    return { ...harness, changed };
  });

  it.effect(
    "keeps a moved Literature Note under its key and says it moved",
    () =>
      Effect.gen(function* () {
        const { service, vault, changed } = yield* loaded({
          "literatures/paper.md": cache({ itemKey: ITEM_A }),
        });

        vault.renameFile("literatures/paper.md", "Drafts/moved.md");
        yield* Effect.promise(() => service.whenSettled());
        expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual([
          "Drafts/moved.md",
        ]);
        expect(changed).toEqual(["Drafts/moved.md"]);

        vault.renameFile("Drafts/moved.md", "literatures/paper.md");
        yield* Effect.promise(() => service.whenSettled());
        expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual([
          "literatures/paper.md",
        ]);
      }),
  );

  it.effect(
    "drops a Literature Note renamed out of Markdown and takes it back on the way in",
    () =>
      Effect.gen(function* () {
        const { service, vault, changed } = yield* loaded({
          "paper.md": cache({ itemKey: ITEM_A }),
        });

        vault.renameFile("paper.md", "paper.md.away");
        yield* Effect.promise(() => service.whenSettled());
        expect(service.getNotesByItemKey(ITEM_A)).toEqual([]);

        // The cache still holds the parse under the restored path and reports no change.
        vault.renameFile("paper.md.away", "paper.md");
        yield* Effect.promise(() => service.whenSettled());
        expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual(["paper.md"]);
        expect(changed).toEqual(["paper.md.away", "paper.md"]);
      }),
  );

  it.effect("stays quiet for a renamed ordinary note", () =>
    Effect.gen(function* () {
      const { service, vault, changed } = yield* loaded({
        "plain.md": cache({}),
      });

      vault.renameFile("plain.md", "Notes/plain.md");
      yield* Effect.promise(() => service.whenSettled());

      expect(changed).toEqual([]);
    }),
  );

  it.effect(
    "indexes a file renamed into Markdown once the cache reports its parse",
    () =>
      Effect.gen(function* () {
        const { service, vault, metadataCache } = yield* loaded({});
        vault.addFile("paper.txt");

        // The cache holds nothing for the file yet.
        const file = vault.renameFile("paper.txt", "paper.md");
        yield* Effect.promise(() => service.whenSettled());
        expect(service.getNotesByItemKey(ITEM_A)).toEqual([]);

        metadataCache.change(file, cache({ itemKey: ITEM_A }));
        expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual(["paper.md"]);
      }),
  );
});
