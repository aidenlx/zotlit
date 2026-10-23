import { TestClock } from "effect/testing";
import { TFile } from "obsidian";
import type { CachedMetadata } from "obsidian";
import { afterEach, describe, expect } from "vitest";

import { Effect } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";
import type { PlainCitationIndex } from "@/services/citation-index/plain";
import { inProcessParseClient } from "@/services/citation-parse/in-process";

import {
  GROUP_KEY,
  myLibraryRow,
  sameLibraryTwin,
  groupTwin,
  bothLibraries,
} from "./__fixtures__/ambiguous";
import type { CitationSyntax } from "./scan";
import type { CitedBySnapshot, Citation } from "./service";
import {
  createCitationIndexHarness,
  DatabaseStub,
  GROUP_LIBRARY_ID,
  groupLibrary,
  KEY_A,
  KEY_B,
  LibraryScopeStub,
  link,
  MemoryStore,
  MY_LIBRARY_ID,
  personalLibrary,
  SettingsStub,
} from "./test-harness";
import type {
  CitationIndexHarness,
  CitationIndexHarnessOptions,
} from "./test-harness";

const harnesses: CitationIndexHarness[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0).reverse()) {
    await harness[Symbol.asyncDispose]();
  }
});

async function citationsOf(
  index: PlainCitationIndex,
  file: TFile,
): Promise<Citation[]> {
  return (await index.getDocumentCitationSet(file)).citations;
}

describe("CitationIndex", () => {
  it.effect.each([
    ["[[Doe\u00a02024]]", undefined],
    ["[[Doe 2024\\]]", undefined],
    ["[[Doe\u00a02024#cite:locator=4\\]]", "locator=4"],
  ] as const)(
    "#1683 resolves normalized Wikilink Citations in References and Cited By: %s",
    ([body, fragment]) =>
      Effect.promise(async () => {
        await using harness = await createCitationIndexHarness(
          { "draft.md": body },
          { settings: { "citation.wikilink-citations": true } },
        );
        harness.workspace.layoutReady();
        await harness.index.whenIndexed();
        const set = await harness.index.getDocumentCitationSet(harness.draft);
        expect(set.citations.map(({ indexedKey }) => indexedKey)).toEqual([
          KEY_A,
        ]);
        expect(set.occurrences[0]).toMatchObject({ raw: "Doe 2024" });
        expect(set.occurrences[0]?.fragment).toBe(fragment);
        expect((await harness.index.getCitedBy(KEY_A)).groups).toMatchObject([
          { path: "draft.md", occurrences: [{ raw: "Doe 2024" }] },
        ]);
      }),
  );

  it.effect(
    "keeps Cited By backlinks when membership changes after a failed refresh",
    () =>
      Effect.promise(async () => {
        const { index, citekeys, db, draft, metadataCache, workspace } =
          await makeHarness({ "draft.md": "@doe2024" });
        workspace.layoutReady();
        const snapshots: CitedBySnapshot[] = [];
        const stop = index.observeCitedBy(KEY_A, (snapshot) =>
          snapshots.push(snapshot),
        );
        await expect.poll(() => snapshots.at(-1)?.groups.length).toBe(1);
        citekeys.error = new Error("unavailable");
        db.changed();
        await expect.poll(() => snapshots.at(-1)?.resolution).toBe("failed");
        metadataCache.change(draft, "@doe2024 @newKey");
        await index.getFileScan(draft);

        expect(snapshots.at(-1)?.groups.map((group) => group.path)).toEqual([
          "draft.md",
        ]);
        stop();
      }),
  );

  it.effect(
    "groups wikilinks with the same local identity used for the reverse batch",
    () =>
      Effect.promise(async () => {
        const db = new DatabaseStub();
        const { index, draft, metadataCache, lookup } = await makeHarness(
          { "draft.md": "[[Doe 2024]]" },
          { db, settings: { "citation.wikilink-citations": true } },
        );
        metadataCache.fileCache.set(draft.path, {
          links: [link("Doe 2024", 0)],
        } as CachedMetadata);
        await lookup.whenResolved();
        const held = db.holdLookup();
        const pending = index.getDocumentCitationSet(draft);
        await held.entered;
        metadataCache.fileCache.set("Doe 2024.md", {
          frontmatter: { "zotero-key": KEY_B },
        } as CachedMetadata);
        held.release();
        const set = await pending;
        expect(set.citations[0]?.indexedKey).toBe(KEY_A);
        expect(set.lookup.citekeyOf(KEY_A)).toBe("doe2024");
        expect(() => set.lookup.citekeyOf(KEY_B)).toThrow(KEY_B);
      }),
  );

  it.effect(
    "lists the literal citekeys of a document with their Reference Numbers",
    () =>
      Effect.promise(async () => {
        const { draft, index } = await makeHarness({
          "draft.md": "Cited by @doe2024 and @roe2025, then @doe2024 again.",
        });

        const citations = await citationsOf(index, draft);

        expect(citations).toMatchObject([
          { indexedKey: KEY_A, linkpath: "Doe 2024.md", refNumber: 1 },
          { indexedKey: KEY_B, linkpath: "Roe 2025.md", refNumber: 2 },
        ]);
        expect(citations[0]!.occurrences).toHaveLength(2);
      }),
  );

  it.effect("keeps a citekey no Literature Note carries", () =>
    Effect.promise(async () => {
      const { draft, index } = await makeHarness({
        "draft.md": "See @typo2024.",
      });

      expect(await citationsOf(index, draft)).toMatchObject([
        { indexedKey: null, linkpath: null, refNumber: 1 },
      ]);
    }),
  );

  it.effect("positions an occurrence at its place in the source", () =>
    Effect.promise(async () => {
      const { draft, index } = await makeHarness({
        "draft.md": "# Title\n\nAs @doe2024 wrote.\n",
      });

      const [citation] = await citationsOf(index, draft);

      expect(citation!.occurrences[0]!.position).toEqual({
        start: { line: 2, col: 3, offset: 12 },
        end: { line: 2, col: 11, offset: 20 },
      });
    }),
  );

  it.effect("merges stored wikilink occurrences in document order", () =>
    Effect.promise(async () => {
      const { draft, index, metadataCache } = await makeHarness(
        { "draft.md": "As @roe2025 wrote, see [[Doe 2024]]." },
        { settings: { "citation.wikilink-citations": true } },
      );
      metadataCache.fileCache.set("draft.md", {
        links: [link("Doe 2024", 23)],
      } as CachedMetadata);

      const citations = await citationsOf(index, draft);

      expect(citations).toMatchObject([
        { indexedKey: KEY_B, refNumber: 1 },
        { indexedKey: KEY_A, linkpath: "Doe 2024", refNumber: 2 },
      ]);
    }),
  );

  it.effect(
    "returns one ordered Document Citation Set for both consumers",
    () =>
      Effect.promise(async () => {
        const body = "First @roe2025, then [[Doe 2024]], then @roe2025.";
        const { draft, index, metadataCache } = await makeHarness(
          { "draft.md": body },
          { settings: { "citation.wikilink-citations": true } },
        );
        metadataCache.fileCache.set("draft.md", {
          links: [link("Doe 2024", body.indexOf("[["))],
        } as CachedMetadata);

        const set = await index.getDocumentCitationSet(draft);

        expect(set.occurrences.map(({ kind, raw }) => [kind, raw])).toEqual([
          ["citekey", "roe2025"],
          ["wikilink", "Doe 2024"],
          ["citekey", "roe2025"],
        ]);
        expect(set.citations).toMatchObject([
          { indexedKey: KEY_B, refNumber: 1, occurrences: [{}, {}] },
          { indexedKey: KEY_A, refNumber: 2, occurrences: [{}] },
        ]);
      }),
  );

  it.effect(
    "admits only eligible Literature Note wikilinks to the shared set",
    () =>
      Effect.promise(async () => {
        const { draft, index, metadataCache } = await makeHarness(
          {
            "draft.md":
              "[[Doe 2024]] [[Doe 2024#cite:locator=4]] [[Doe 2024#cite:]] [[Doe 2024#Heading]] [[Doe 2024#^block]] [[Doe 2024|Doe]] ![[Doe 2024]] [Doe](Doe%202024)",
          },
          { settings: { "citation.wikilink-citations": true } },
        );
        metadataCache.fileCache.set("draft.md", {
          links: [
            link("Doe 2024", 0),
            link("Doe 2024#cite:locator=4", 20),
            link("Doe 2024#cite:", 40),
            link("Doe 2024#Heading", 60),
            link("Doe 2024#^block", 80),
            link("Doe 2024", 100, "[[Doe 2024|Doe]]"),
            link("Doe 2024", 120, "![[Doe 2024]]"),
            link("Doe 2024", 140, "[Doe](Doe 2024)"),
          ],
        } as CachedMetadata);

        const set = await index.getDocumentCitationSet(draft);

        expect(set.occurrences.map(({ raw }) => raw)).toEqual([
          "Doe 2024",
          "Doe 2024",
        ]);
      }),
  );

  it.effect(
    "recomputes membership after a source choice without rebuilding the scan",
    () =>
      Effect.promise(async () => {
        const body = "See @roe2025 and [[Doe 2024]].";
        const { draft, index, metadataCache, settings, vault } =
          await makeHarness({
            "draft.md": body,
          });
        metadataCache.fileCache.set("draft.md", {
          links: [link("Doe 2024", body.indexOf("[["))],
        } as CachedMetadata);
        let changed = 0;
        index.on("membership-changed", () => changed++);

        expect(
          (await index.getDocumentCitationSet(draft)).occurrences.map(
            ({ kind }) => kind,
          ),
        ).toEqual(["citekey"]);
        settings.update({
          "citation.pandoc-citations": false,
          "citation.wikilink-citations": true,
        });
        expect(
          (await index.getDocumentCitationSet(draft)).occurrences.map(
            ({ kind }) => kind,
          ),
        ).toEqual(["wikilink"]);

        expect(changed).toBe(1);
        expect(vault.reads).toEqual(["draft.md"]);
      }),
  );

  it.effect("applies all four independent source combinations", () =>
    Effect.promise(async () => {
      const body = "See @roe2025 and [[Doe 2024]].";
      const { draft, index, metadataCache, settings } = await makeHarness({
        "draft.md": body,
      });
      metadataCache.fileCache.set("draft.md", {
        links: [link("Doe 2024", body.indexOf("[["))],
      } as CachedMetadata);

      expect(
        (await index.getDocumentCitationSet(draft)).occurrences.map(
          ({ kind }) => kind,
        ),
      ).toEqual(["citekey"]);

      settings.update({ "citation.wikilink-citations": true });
      expect(
        (await index.getDocumentCitationSet(draft)).occurrences.map(
          ({ kind }) => kind,
        ),
      ).toEqual(["citekey", "wikilink"]);

      settings.update({ "citation.pandoc-citations": false });
      expect(
        (await index.getDocumentCitationSet(draft)).occurrences.map(
          ({ kind }) => kind,
        ),
      ).toEqual(["wikilink"]);

      settings.update({ "citation.wikilink-citations": false });
      expect(await index.getDocumentCitationSet(draft)).toMatchObject({
        occurrences: [],
        citations: [],
        errors: [],
      });
    }),
  );

  it.effect(
    "reports which syntaxes admit their occurrences, and follows a settings update",
    () =>
      Effect.promise(async () => {
        const { index, settings } = await makeHarness({});

        expect(index.syntaxes()).toEqual({
          citekey: "included",
          wikilink: "excluded",
          annotation: "included",
        });

        settings.update({
          "citation.pandoc-citations": false,
          "citation.wikilink-citations": true,
        });

        expect(index.syntaxes()).toEqual({
          citekey: "excluded",
          wikilink: "included",
          annotation: "included",
        });
      }),
  );

  it.effect(
    "answers the admitted occurrences of every covered document by path",
    () =>
      Effect.promise(async () => {
        const { index, metadataCache, settings, workspace } = await makeHarness(
          {
            "draft.md": "As @doe2024 and [[Roe 2025]] say; @doe2024 again.",
            "plain.md": "No citation here.",
            "other.md": "Only [[Doe 2024]].",
          },
          { settings: { "citation.wikilink-citations": true } },
        );
        metadataCache.fileCache.set("draft.md", {
          links: [link("Roe 2025", 15)],
        } as CachedMetadata);
        metadataCache.fileCache.set("other.md", {
          links: [link("Doe 2024", 5)],
        } as CachedMetadata);
        workspace.layoutReady();
        await index.whenIndexed();

        const summary = (
          syntaxes: CitationSyntax[] = ["citekey", "wikilink"],
        ) =>
          [...index.citationsByPath(syntaxes)].map(([path, occurrences]) => [
            path,
            occurrences.map(({ kind, raw }) => `${kind}:${raw}`),
          ]);

        expect(summary()).toEqual([
          [
            "draft.md",
            ["citekey:doe2024", "citekey:doe2024", "wikilink:Roe 2025"],
          ],
          ["other.md", ["wikilink:Doe 2024"]],
        ]);
        expect(summary(["citekey"])).toEqual([
          ["draft.md", ["citekey:doe2024", "citekey:doe2024"]],
        ]);

        settings.update({ "citation.wikilink-citations": false });
        expect(summary()).toEqual([
          ["draft.md", ["citekey:doe2024", "citekey:doe2024"]],
        ]);

        settings.update({
          "citation.pandoc-citations": false,
          "citation.wikilink-citations": true,
        });
        expect(summary()).toEqual([
          ["draft.md", ["wikilink:Roe 2025"]],
          ["other.md", ["wikilink:Doe 2024"]],
        ]);
      }),
  );

  it.effect(
    "leaves a document the backfill has not reached out of the per-path read",
    () =>
      Effect.promise(async () => {
        const { index } = await makeHarness({
          "draft.md": "As @doe2024 wrote.",
        });

        expect(index.citationsByPath(["citekey", "wikilink"]).size).toBe(0);
      }),
  );

  it.effect("reports malformed Citation Fragments without numbering them", () =>
    Effect.promise(async () => {
      const body = "Bad [[Doe 2024#cite:locator=]] then @roe2025.";
      const { draft, index, metadataCache } = await makeHarness(
        { "draft.md": body },
        { settings: { "citation.wikilink-citations": true } },
      );
      const offset = body.indexOf("[[");
      metadataCache.fileCache.set("draft.md", {
        links: [link("Doe 2024#cite:locator=", offset)],
      } as CachedMetadata);

      const set = await index.getDocumentCitationSet(draft);

      expect(set.citations).toMatchObject([
        { indexedKey: KEY_B, refNumber: 1 },
      ]);
      expect(set.errors).toMatchObject([
        {
          kind: "malformed-wikilink",
          occurrence: {
            kind: "wikilink",
            raw: "Doe 2024",
            position: link("Doe 2024#cite:locator=", offset).position,
          },
        },
      ]);
    }),
  );

  it.effect("leaves wikilinks out while Wikilink Citations is off", () =>
    Effect.promise(async () => {
      const { draft, index, metadataCache } = await makeHarness({
        "draft.md": "As @roe2025 wrote, see [[Doe 2024]].",
      });
      metadataCache.fileCache.set("draft.md", {
        links: [link("Doe 2024", 23)],
      } as CachedMetadata);

      expect(await citationsOf(index, draft)).toMatchObject([
        { indexedKey: KEY_B, refNumber: 1 },
      ]);
    }),
  );

  // Pandoc reads `[[@doe2024]]` as a wikilink, so the export cites nothing
  // there; the References sidebar must agree.
  it.effect(
    "reads no citekey inside a wikilink while Wikilink Citations is off",
    () =>
      Effect.promise(async () => {
        const { draft, index, metadataCache } = await makeHarness({
          "draft.md": "As @roe2025 wrote, see [[@doe2024]].",
        });
        metadataCache.fileCache.set("draft.md", {
          links: [link("@doe2024", 23)],
        } as CachedMetadata);

        expect(await citationsOf(index, draft)).toMatchObject([
          { indexedKey: KEY_B, refNumber: 1 },
        ]);
      }),
  );

  it.effect(
    "leaves citekeys inside code, math, comments, and frontmatter out",
    () =>
      Effect.promise(async () => {
        const { draft, index } = await makeHarness({
          "draft.md": [
            "---",
            "cite: @doe2024",
            "---",
            "",
            "```md",
            "@doe2024",
            "```",
            "",
            "    @doe2024",
            "",
            "Inline `@doe2024`, math $x = @doe2024$, and %% @doe2024 %% too.",
            "",
            "$$",
            "@doe2024",
            "$$",
            "",
            "Only @roe2025 counts.",
          ].join("\n"),
        });

        expect(await citationsOf(index, draft)).toMatchObject([
          { indexedKey: KEY_B, refNumber: 1 },
        ]);
      }),
  );

  // Indented list content is no code block, an unpaired backtick opens no code
  // span, and a price pair is no math — each would swallow a real citation.
  it.effect("keeps citekeys that only look like code or math", () =>
    Effect.promise(async () => {
      const { draft, index } = await makeHarness({
        "draft.md": [
          "- item",
          "",
          "    Indented under the list, citing @doe2024.",
          "",
          "It cost $5 and @roe2025 says $6 isn't a formula.",
          "",
          "A lone ` backtick keeps @doe2024 readable.",
        ].join("\n"),
      });

      const citations = await citationsOf(index, draft);

      expect(citations).toMatchObject([
        { indexedKey: KEY_A, refNumber: 1 },
        { indexedKey: KEY_B, refNumber: 2 },
      ]);
      expect(citations[0]!.occurrences).toHaveLength(2);
    }),
  );

  it.effect("rescans a document when its metadata changes", () =>
    Effect.promise(async () => {
      const { draft, index, metadataCache } = await makeHarness({
        "draft.md": "As @doe2024 wrote.",
      });
      await citationsOf(index, draft);

      metadataCache.change(draft, "As @roe2025 wrote.");

      expect(await citationsOf(index, draft)).toMatchObject([
        { indexedKey: KEY_B, refNumber: 1 },
      ]);
    }),
  );

  it.effect("stays quiet when a change leaves the citekeys identical", () =>
    Effect.promise(async () => {
      const { draft, index, metadataCache } = await makeHarness({
        "draft.md": "As @doe2024 wrote.",
      });
      await citationsOf(index, draft);
      let notified = 0;
      index.on("changed", () => notified++);

      metadataCache.change(draft, "As @doe2024 wrote.");
      await citationsOf(index, draft);

      expect(notified).toBe(0);
    }),
  );

  it.effect("reports a document whose citekeys changed", () =>
    Effect.promise(async () => {
      const { draft, index, metadataCache } = await makeHarness({
        "draft.md": "As @doe2024 wrote.",
      });
      await citationsOf(index, draft);
      const changed: string[] = [];
      index.on("changed", (path) => changed.push(path));

      metadataCache.change(draft, "As @doe2024 and @roe2025 wrote.");

      await expect.poll(() => changed).toEqual(["draft.md"]);
    }),
  );

  it.effect("keeps a renamed document indexed under its new path", () =>
    Effect.promise(async () => {
      const { draft, index, vault } = await makeHarness({
        "draft.md": "As @doe2024 wrote.",
      });
      await citationsOf(index, draft);

      vault.rename(draft, "Notes/paper.md");

      expect(await citationsOf(index, draft)).toMatchObject([
        { indexedKey: KEY_A },
      ]);
      expect(vault.bodies.has("draft.md")).toBe(false);
    }),
  );

  it.effect("drops a deleted document", () =>
    Effect.promise(async () => {
      const { draft, index, vault, workspace } = await makeHarness({
        "draft.md": "As @doe2024 wrote.",
      });
      workspace.layoutReady();
      await index.whenIndexed();
      const changed: string[] = [];
      index.on("changed", (path) => changed.push(path));

      vault.deleteFile(draft);

      expect(changed).toEqual(["draft.md"]);
      expect(await citationsOf(index, draft)).toEqual([]);
    }),
  );

  it.effect("answers for a document the backfill has not reached", () =>
    Effect.promise(async () => {
      const { draft, index } = await makeHarness({
        "draft.md": "As @doe2024 wrote.",
      });

      expect(await citationsOf(index, draft)).toMatchObject([
        { indexedKey: KEY_A },
      ]);
    }),
  );

  it.effect("covers the vault once the backfill finishes", () =>
    Effect.promise(async () => {
      const { index, metadataCache, workspace } = await makeHarness({
        "draft.md": "As @doe2024 wrote.",
        "other.md": "As @roe2025 wrote.",
      });
      let backfilled = false;
      void index.whenIndexed().then(() => (backfilled = true));

      expect(backfilled).toBe(false);
      workspace.layoutReady();
      await index.whenIndexed();

      const other = metadataCache.files.get("other.md")!;
      expect(await citationsOf(index, other)).toMatchObject([
        { indexedKey: KEY_B },
      ]);
    }),
  );

  it.effect("settles whenIndexed when disposal precedes the backfill", () =>
    Effect.promise(async () => {
      const { index, closeIndex } = await makeHarness({
        "draft.md": "As @doe2024 wrote.",
      });
      const waiting = index.whenIndexed();

      await closeIndex();

      await expect(waiting).resolves.toBeUndefined();
      await expect(index.whenIndexed()).resolves.toBeUndefined();
    }),
  );

  it.effect("keeps internal scans active while Pandoc Citations is off", () =>
    Effect.promise(async () => {
      const {
        draft,
        lookup,
        index,
        metadataCache,
        settings,
        vault,
        workspace,
      } = await makeHarness(
        { "draft.md": "As @doe2024 wrote, see [[Roe 2025]]." },
        {
          settings: {
            "citation.pandoc-citations": false,
            "citation.wikilink-citations": true,
          },
        },
      );
      metadataCache.fileCache.set("draft.md", {
        links: [link("Roe 2025", 23)],
      } as CachedMetadata);

      expect(await citationsOf(index, draft)).toMatchObject([
        { indexedKey: KEY_B, refNumber: 1 },
      ]);
      expect(
        (await lookup.read({ citekeys: ["doe2024"] })).resolve("doe2024"),
      ).toMatchObject({
        kind: "unique",
        item: { indexedKey: KEY_A },
      });

      metadataCache.change(draft, "As @roe2025 wrote.");
      settings.update({ "citation.pandoc-citations": true });
      expect(await citationsOf(index, draft)).toMatchObject([
        {
          indexedKey: KEY_B,
          refNumber: 1,
          occurrences: [{ kind: "citekey", raw: "roe2025" }],
        },
      ]);

      settings.update({ "citation.pandoc-citations": false });
      workspace.layoutReady();
      await index.whenIndexed();
      vault.reads.length = 0;
      await index.reset();
      await index.whenIndexed();
      expect(vault.reads).toContain("draft.md");
    }),
  );

  it.effect("stops indexing after disposal", () =>
    Effect.promise(async () => {
      const { draft, index, metadataCache, store, closeIndex } =
        await makeHarness({
          "draft.md": "As @doe2024 wrote.",
        });
      await citationsOf(index, draft);
      store.writes.length = 0;
      const changed: string[] = [];
      index.on("changed", (path) => changed.push(path));

      await closeIndex();
      metadataCache.change(draft, "As @roe2025 wrote.");

      expect(changed).toEqual([]);
      expect(store.writes).toEqual([]);
    }),
  );
});

describe("CitationIndex persistence", () => {
  it.effect("adopts a stored scan for a file the vault has not touched", () =>
    Effect.promise(async () => {
      const store = new MemoryStore();
      await warmVault({ "draft.md": "As @doe2024 wrote." }, store);

      const { draft, index, vault, workspace } = await makeHarness(
        { "draft.md": "As @doe2024 wrote." },
        { store },
      );
      workspace.layoutReady();
      await index.whenIndexed();

      expect(vault.reads).toEqual([]);
      expect(await citationsOf(index, draft)).toMatchObject([
        { indexedKey: KEY_A, refNumber: 1 },
      ]);
    }),
  );

  it.effect(
    "re-scans a file edited to the same length while the app was closed",
    () =>
      Effect.promise(async () => {
        const store = new MemoryStore();
        await warmVault({ "draft.md": "As @doe2024 wrote." }, store);

        const { draft, index, vault, workspace } = await makeHarness(
          { "draft.md": "As @roe2025 wrote." },
          { store },
        );
        workspace.layoutReady();
        await index.whenIndexed();

        expect(vault.reads).toEqual(["draft.md"]);
        expect(await citationsOf(index, draft)).toMatchObject([
          { indexedKey: KEY_B, refNumber: 1 },
        ]);
      }),
  );

  it.effect("writes the record of the one file that changed", () =>
    Effect.promise(async () => {
      const { draft, index, metadataCache, store, workspace } =
        await makeHarness({
          "draft.md": "As @doe2024 wrote.",
          "other.md": "As @roe2025 wrote.",
        });
      workspace.layoutReady();
      await index.whenIndexed();
      store.writes.length = 0;

      metadataCache.change(draft, "As @doe2024 and @roe2025 wrote.");

      await expect.poll(() => store.writes).toEqual(["draft.md"]);
    }),
  );

  it.effect("forgets the stored scan of a deleted document", () =>
    Effect.promise(async () => {
      const { draft, index, store, vault, workspace } = await makeHarness({
        "draft.md": "As @doe2024 wrote.",
      });
      workspace.layoutReady();
      await index.whenIndexed();

      vault.deleteFile(draft);

      expect(store.records.has("draft.md")).toBe(false);
    }),
  );

  it.effect("clears the stored scans and rebuilds on reset", () =>
    Effect.promise(async () => {
      const store = new MemoryStore();
      const { draft, index, vault, workspace } = await makeHarness(
        { "draft.md": "As @doe2024 wrote." },
        { store },
      );
      workspace.layoutReady();
      await index.whenIndexed();
      vault.reads.length = 0;

      await index.reset();
      await index.whenIndexed();

      expect(vault.reads).toContain("draft.md");
      expect(store.records.has("draft.md")).toBe(true);
      expect(await citationsOf(index, draft)).toMatchObject([
        { indexedKey: KEY_A },
      ]);
    }),
  );

  it.effect(
    "keeps a backfill in flight from writing its scan past a reset",
    () =>
      Effect.promise(async () => {
        const store = new MemoryStore();
        const { draft, index, vault, workspace } = await makeHarness(
          { "draft.md": "As @doe2024 wrote." },
          { store },
        );
        const release = vault.hold("draft.md");
        workspace.layoutReady();
        // Wait until the backfill parks on the held host read.
        await expect.poll(() => vault.reads).toContain("draft.md");

        vault.write(draft, "As @roe2025 wrote.");
        await index.reset();
        await index.whenIndexed();
        release();

        // The parked read still holds the pre-reset body; a later session must not
        // find it, so the restart adopts what the rebuild wrote and reads nothing.
        const restored = await makeHarness(
          { "draft.md": "As @roe2025 wrote." },
          { store },
        );
        restored.workspace.layoutReady();
        await restored.index.whenIndexed();

        expect(restored.vault.reads).toEqual([]);
        expect(await citationsOf(restored.index, restored.draft)).toMatchObject(
          [{ indexedKey: KEY_B }],
        );
      }),
  );
});

describe("CitationIndex resolution", () => {
  it.effect("resolves a citekey with no Literature Note in the vault", () =>
    Effect.promise(async () => {
      const { lookup, draft, index } = await makeHarness(
        { "draft.md": "As @doe2024 wrote." },
        { notes: false },
      );

      expect(await citationsOf(index, draft)).toMatchObject([
        { indexedKey: KEY_A, linkpath: null },
      ]);
      expect(
        (await lookup.read({ indexedKeys: [KEY_A] })).citekeyOf(KEY_A),
      ).toBe("doe2024");
    }),
  );

  it.effect("waits for a successful lookup when reading a document", () =>
    Effect.promise(async () => {
      const db = new DatabaseStub({ readyImmediately: false });
      const { lookup, index, citekeys, draft, passCooldown } =
        await makeHarness(
          { "draft.md": "As @doe2024 wrote." },
          { db, notes: false },
        );
      citekeys.error = new Error("torn read");
      db.settle();
      await lookup.whenResolved();
      await expect(citationsOf(index, draft)).rejects.toThrow();
      citekeys.error = null;
      passCooldown();
      expect(await citationsOf(index, draft)).toMatchObject([
        { indexedKey: KEY_A },
      ]);
    }),
  );

  it.effect(
    "observes resolved literal citekeys grouped by path and source position",
    () =>
      Effect.promise(async () => {
        const { index, workspace } = await makeHarness({
          "z-last.md": "@doe2024 later, @doe2024 first.",
          "a-first.md": "@doe2024.",
          "unresolved.md": "@missing.",
        });
        const snapshots: CitedBySnapshot[] = [];
        index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));

        await expect
          .poll(() => snapshots.at(-1))
          .toMatchObject({
            coverage: "indexing",
            resolution: "fresh",
            groups: [],
          });
        workspace.layoutReady();
        await index.whenIndexed();

        await expect
          .poll(() => snapshots.at(-1))
          .toMatchObject({
            coverage: "complete",
            resolution: "fresh",
            groups: [
              { path: "a-first.md", occurrences: [{ raw: "doe2024" }] },
              {
                path: "z-last.md",
                occurrences: [{ raw: "doe2024" }, { raw: "doe2024" }],
              },
            ],
          });
        await expect
          .poll(
            () =>
              snapshots.at(-1)!.groups[1]!.occurrences[0]!.position.start
                .offset,
          )
          .toBe(0);
      }),
  );

  it.effect(
    "orders occurrences with the same start position deterministically",
    () =>
      Effect.promise(async () => {
        const { index, workspace } = await makeHarness(
          { "draft.md": "@doe2024" },
          {
            settings: { "citation.wikilink-citations": true },
            parseClient: {
              async parse(request, signal) {
                const reply = await inProcessParseClient.parse(request, signal);
                if (request.path === "draft.md") {
                  reply.record.wikilinks = [
                    {
                      kind: "wikilink",
                      raw: "Doe 2024",
                      position: link("Doe 2024", 0).position,
                    },
                  ];
                }
                return reply;
              },
            },
          },
        );
        const snapshots: CitedBySnapshot[] = [];
        index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));

        workspace.layoutReady();
        await index.whenIndexed();

        await expect
          .poll(() =>
            snapshots
              .at(-1)
              ?.groups[0]?.occurrences.map(
                ({ kind, position }) => [kind, position.end.offset] as const,
              ),
          )
          .toEqual([
            ["citekey", 8],
            ["wikilink", 12],
          ]);
      }),
  );

  it.effect("publishes after listener registration with settled settings", () =>
    Effect.promise(async () => {
      const settings = new SettingsStub();
      const { index } = await makeHarness(
        { "draft.md": "@doe2024." },
        { settingsService: settings },
      );
      const snapshots: CitedBySnapshot[] = [];
      index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));

      await expect
        .poll(() => snapshots)
        .toMatchObject([{ resolution: "fresh" }]);
    }),
  );

  it.effect("stays silent when disposed during listener registration", () =>
    Effect.promise(async () => {
      const settings = new SettingsStub();
      const { index } = await makeHarness(
        { "draft.md": "@doe2024." },
        { settingsService: settings },
      );
      const snapshots: CitedBySnapshot[] = [];
      const stop = index.observeCitedBy(KEY_A, (snapshot) =>
        snapshots.push(snapshot),
      );

      stop();

      await expect.poll(() => snapshots).toEqual([]);
    }),
  );

  it.effect(
    "omits literal occurrences while Pandoc citation membership is off",
    () =>
      Effect.promise(async () => {
        const { index, workspace } = await makeHarness(
          { "draft.md": "@doe2024." },
          { settings: { "citation.pandoc-citations": false } },
        );
        const snapshots: CitedBySnapshot[] = [];
        index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));

        workspace.layoutReady();
        await index.whenIndexed();

        await expect
          .poll(() => snapshots.at(-1))
          .toMatchObject({
            groups: [],
            coverage: "complete",
          });
      }),
  );

  it.effect(
    "omits wikilink occurrences while Wikilink citation membership is off",
    () =>
      Effect.promise(async () => {
        const body = "See [[Doe 2024]].";
        const { index, metadataCache, workspace } = await makeHarness({
          "draft.md": body,
        });
        metadataCache.fileCache.set("draft.md", {
          links: [link("Doe 2024", body.indexOf("[["))],
        } as CachedMetadata);
        const snapshots: CitedBySnapshot[] = [];
        index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));

        workspace.layoutReady();
        await index.whenIndexed();

        await expect
          .poll(() => snapshots.at(-1))
          .toMatchObject({
            groups: [],
            coverage: "complete",
          });
      }),
  );

  it.effect("republishes the reverse observation after a source choice", () =>
    Effect.promise(async () => {
      const { index, settings, workspace } = await makeHarness(
        { "draft.md": "@doe2024." },
        { settings: { "citation.pandoc-citations": false } },
      );
      const snapshots: CitedBySnapshot[] = [];
      index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));

      workspace.layoutReady();
      await index.whenIndexed();
      await expect.poll(() => snapshots.at(-1)).toMatchObject({ groups: [] });

      settings.update({ "citation.pandoc-citations": true });

      await expect
        .poll(() => snapshots.at(-1))
        .toMatchObject({
          groups: [{ path: "draft.md" }],
        });
    }),
  );

  it.effect("omits a restored scan that no longer describes its file", () =>
    Effect.promise(async () => {
      const store = new MemoryStore();
      await warmVault({ "draft.md": "As @doe2024 wrote." }, store);
      const { index } = await makeHarness(
        { "draft.md": "As @roe2025 wrote." },
        { store },
      );
      const snapshots: CitedBySnapshot[] = [];

      index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));

      await expect
        .poll(() => snapshots)
        .toMatchObject([{ coverage: "indexing", groups: [] }]);
    }),
  );

  it.effect("reports degraded coverage while retaining successful scans", () =>
    Effect.promise(async () => {
      const { index, vault, workspace } = await makeHarness({
        "a-good.md": "@doe2024.",
        "z-bad.md": "@doe2024.",
      });
      vault.fail("z-bad.md");
      const snapshots: CitedBySnapshot[] = [];
      index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));

      workspace.layoutReady();
      await index.whenIndexed();

      await expect
        .poll(() => snapshots.at(-1))
        .toMatchObject({
          coverage: "degraded",
          groups: [{ path: "a-good.md" }],
        });
    }),
  );

  it.effect(
    "retains resolved results when citation-key resolution degrades",
    () =>
      Effect.promise(async () => {
        const { citekeys, db, index, workspace } = await makeHarness({
          "draft.md": "@doe2024.",
        });
        const snapshots: CitedBySnapshot[] = [];
        index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));
        workspace.layoutReady();
        await index.whenIndexed();

        await expect
          .poll(() => snapshots.at(-1)?.groups)
          .toMatchObject([{ path: "draft.md" }]);
        citekeys.error = new Error("database read failed");
        db.changed();

        await expect
          .poll(() => snapshots.at(-1))
          .toMatchObject({
            resolution: "failed",
            groups: [{ path: "draft.md" }],
          });
      }),
  );

  it.effect(
    "retains wikilinks while the first resolution read settles without a value",
    () =>
      Effect.promise(async () => {
        const db = new DatabaseStub();
        const pending = db.holdLookup();
        const body = "See [[Doe 2024]].";
        const { draft, lookup, index, metadataCache, workspace } =
          await makeHarness(
            { "draft.md": body },
            { db, settings: { "citation.wikilink-citations": true } },
          );
        metadataCache.fileCache.set("draft.md", {
          links: [link("Doe 2024", body.indexOf("[["))],
        } as CachedMetadata);
        const snapshots: CitedBySnapshot[] = [];
        index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));

        workspace.layoutReady();
        await index.whenIndexed();
        await expect
          .poll(() => snapshots.at(-1))
          .toMatchObject({
            resolution: null,
            groups: [{ path: draft.path, occurrences: [{ kind: "wikilink" }] }],
          });

        db.state = "degraded";
        pending.release();
        await lookup.whenResolved();

        await expect
          .poll(() => snapshots.at(-1))
          .toMatchObject({
            resolution: "failed",
            groups: [{ path: draft.path, occurrences: [{ kind: "wikilink" }] }],
          });
      }),
  );

  it.effect("returns to indexing when reset starts a new pass", () =>
    Effect.promise(async () => {
      const { index, vault, workspace } = await makeHarness({
        "draft.md": "@doe2024.",
      });
      const snapshots: CitedBySnapshot[] = [];
      index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));
      workspace.layoutReady();
      await index.whenIndexed();
      const release = vault.hold("draft.md");

      await index.reset();

      await expect.poll(() => snapshots.at(-1)?.coverage).toBe("indexing");

      release();
      await index.whenIndexed();
      await expect.poll(() => snapshots.at(-1)?.coverage).toBe("complete");
    }),
  );

  it.effect(
    "combines eligible wikilinks and literal citekeys through Item identity",
    () =>
      Effect.promise(async () => {
        const body = [
          "@doe2024",
          "[[Doe 2024]]",
          "[[Doe 2024#cite:locator=4]]",
          "[[Doe 2024|alias]]",
          "![[Doe 2024]]",
          "[[Doe 2024#Heading]]",
          "[[Doe 2024#^block]]",
          "[[Doe 2024#cite:locator=]]",
          "[[ordinary]]",
          "[[missing]]",
        ].join(" ");
        const { draft, index, metadataCache, settings, workspace } =
          await makeHarness(
            { "draft.md": body, "ordinary.md": "" },
            { settings: { "citation.wikilink-citations": true } },
          );
        metadataCache.fileCache.set("draft.md", {
          links: [
            link("Doe 2024", body.indexOf("[[Doe 2024]]")),
            link(
              "Doe 2024#cite:locator=4",
              body.indexOf("[[Doe 2024#cite:locator=4]]"),
            ),
            link(
              "Doe 2024",
              body.indexOf("[[Doe 2024|alias]]"),
              "[[Doe 2024|alias]]",
            ),
            link("Doe 2024", body.indexOf("![[Doe 2024]]"), "![[Doe 2024]]"),
            link("Doe 2024#Heading", body.indexOf("[[Doe 2024#Heading]]")),
            link("Doe 2024#^block", body.indexOf("[[Doe 2024#^block]]")),
            link(
              "Doe 2024#cite:locator=",
              body.indexOf("[[Doe 2024#cite:locator=]]"),
            ),
            link("ordinary", body.indexOf("[[ordinary]]")),
            link("missing", body.indexOf("[[missing]]")),
          ],
        } as CachedMetadata);
        const snapshots: CitedBySnapshot[] = [];
        index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));

        workspace.layoutReady();
        await index.whenIndexed();

        await expect
          .poll(() => snapshots.at(-1)?.groups)
          .toMatchObject([
            {
              path: draft.path,
              occurrences: [
                { kind: "citekey", raw: "doe2024" },
                { kind: "wikilink", raw: "Doe 2024" },
                { kind: "wikilink", raw: "Doe 2024" },
              ],
            },
          ]);
        settings.update({
          "citation.pandoc-citations": false,
          "citation.wikilink-citations": false,
        });

        await expect.poll(() => snapshots.at(-1)?.groups).toEqual([]);
      }),
  );

  it.effect("observes a Literature Note that cites its own Item", () =>
    Effect.promise(async () => {
      const { index, metadataCache, workspace } = await makeHarness({});
      const target = metadataCache.files.get("Doe 2024.md")!;
      metadataCache.change(target, "@doe2024.");
      metadataCache.fileCache.set(target.path, {
        frontmatter: { "zotero-key": KEY_A },
        links: [],
      } as CachedMetadata);
      const snapshots: CitedBySnapshot[] = [];
      index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));

      workspace.layoutReady();
      await index.whenIndexed();

      await expect
        .poll(() => snapshots.at(-1)?.groups)
        .toMatchObject([
          {
            path: target.path,
            occurrences: [{ kind: "citekey", raw: "doe2024" }],
          },
        ]);
    }),
  );

  it.effect(
    "keeps a cross-library wikilink while literal resolution changes library",
    () =>
      Effect.promise(async () => {
        const body = "@roe2025 [[Roe 2025]]";
        const libraryScope = new LibraryScopeStub([
          personalLibrary(),
          groupLibrary(),
        ]);
        libraryScope.select([personalLibrary()]);
        const { draft, index, metadataCache, workspace } = await makeHarness(
          { "draft.md": body },
          {
            citekeys: [
              {
                itemID: 1,
                libraryID: MY_LIBRARY_ID,
                key: KEY_A,
                indexedKey: KEY_A,
                citekey: "doe2024",
              },
              {
                itemID: 2,
                libraryID: GROUP_LIBRARY_ID,
                key: "ROE2025",
                indexedKey: KEY_B,
                citekey: "roe2025",
              },
            ],
            libraryScope,
            settings: { "citation.wikilink-citations": true },
          },
        );
        metadataCache.fileCache.set(draft.path, {
          links: [link("Roe 2025", body.indexOf("[["))],
        } as CachedMetadata);
        const snapshots: CitedBySnapshot[] = [];
        index.observeCitedBy(KEY_B, (snapshot) => snapshots.push(snapshot));
        workspace.layoutReady();
        await index.whenIndexed();

        await expect
          .poll(() => snapshots.at(-1)?.groups[0]?.occurrences)
          .toMatchObject([{ kind: "wikilink" }]);

        libraryScope.select([personalLibrary(), groupLibrary()]);

        await expect
          .poll(() => snapshots.at(-1)?.groups[0]?.occurrences)
          .toMatchObject([{ kind: "citekey" }, { kind: "wikilink" }]);
      }),
  );

  it.effect(
    "applies the optional Markdown-note predicate before grouping",
    () =>
      Effect.promise(async () => {
        const { index, workspace } = await makeHarness({
          "Keep/a.md": "@doe2024.",
          "Skip/b.md": "@doe2024.",
        });
        const snapshots: CitedBySnapshot[] = [];
        index.observeCitedBy(
          KEY_A,
          (snapshot) => snapshots.push(snapshot),
          (file) => file.path.startsWith("Keep/"),
        );

        workspace.layoutReady();
        await index.whenIndexed();

        await expect
          .poll(() => snapshots.at(-1)?.groups.map(({ path }) => path))
          .toEqual(["Keep/a.md"]);
      }),
  );

  it.effect(
    "coalesces related edits and publishes only the final changed structure",
    () =>
      Effect.promise(async () => {
        const { draft, index, metadataCache, workspace } = await makeHarness({
          "draft.md": "@doe2024.",
        });
        const snapshots: CitedBySnapshot[] = [];
        index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));
        workspace.layoutReady();
        await index.whenIndexed();
        await expect.poll(() => snapshots.at(-1)?.resolution).toBe("fresh");
        const before = snapshots.length;

        metadataCache.change(draft, "moved @doe2024.");
        metadataCache.change(draft, "moved again @doe2024.");

        await expect.poll(() => snapshots).toHaveLength(before + 1);
        await expect
          .poll(
            () =>
              snapshots.at(-1)?.groups[0]?.occurrences[0]?.position.start
                .offset,
          )
          .toBe(12);
      }),
  );

  it.effect(
    "refreshes wikilink-only metadata and link-resolution changes",
    () =>
      Effect.promise(async () => {
        const body = "See [[Doe 2024]].";
        const { draft, index, metadataCache, workspace } = await makeHarness(
          { "draft.md": body },
          { settings: { "citation.wikilink-citations": true } },
        );
        const snapshots: CitedBySnapshot[] = [];
        index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));
        workspace.layoutReady();
        await index.whenIndexed();

        metadataCache.change(draft, body, [link("Doe 2024", 4)]);

        await expect
          .poll(() => snapshots.at(-1)?.groups)
          .toMatchObject([
            { path: "draft.md", occurrences: [{ kind: "wikilink" }] },
          ]);

        const target = metadataCache.files.get("Doe 2024.md")!;
        metadataCache.fileCache.set("Doe 2024.md", {
          frontmatter: { "zotero-key": KEY_B },
        } as CachedMetadata);
        metadataCache.resolve(target);

        await expect.poll(() => snapshots.at(-1)?.groups).toEqual([]);
      }),
  );

  it.effect(
    "refreshes wikilinks when their target Literature Note moves or is deleted",
    () =>
      Effect.promise(async () => {
        const body = "See [[Doe 2024]].";
        const { draft, index, metadataCache, vault, workspace } =
          await makeHarness(
            { "draft.md": body },
            { settings: { "citation.wikilink-citations": true } },
          );
        metadataCache.fileCache.set(draft.path, {
          links: [link("Doe 2024", body.indexOf("[["))],
        } as CachedMetadata);
        const target = metadataCache.files.get("Doe 2024.md")!;
        const snapshots: CitedBySnapshot[] = [];
        index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));
        workspace.layoutReady();
        await index.whenIndexed();
        await expect.poll(() => snapshots.at(-1)?.groups).toHaveLength(1);

        vault.rename(target, "Literature/Moved.md");

        await expect.poll(() => snapshots.at(-1)?.groups).toEqual([]);

        vault.rename(target, "Doe 2024.md");

        await expect.poll(() => snapshots.at(-1)?.groups).toHaveLength(1);

        vault.deleteFile(target);

        await expect.poll(() => snapshots.at(-1)?.groups).toEqual([]);
      }),
  );

  it.effect(
    "refreshes reverse literal membership after a database change",
    () =>
      Effect.promise(async () => {
        const { citekeys, db, index, workspace } = await makeHarness({
          "draft.md": "@doe2024.",
        });
        const snapshots: CitedBySnapshot[] = [];
        index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));
        workspace.layoutReady();
        await index.whenIndexed();
        await expect.poll(() => snapshots.at(-1)?.groups).toHaveLength(1);

        citekeys.rows = [
          {
            itemID: 2,
            libraryID: GROUP_LIBRARY_ID,
            key: "ZZZ99999",
            indexedKey: KEY_B,
            citekey: "doe2024",
          },
        ];
        db.changed();

        await expect.poll(() => snapshots.at(-1)?.groups).toEqual([]);
      }),
  );

  it.effect(
    "keeps a superseded backfill read out of reverse publications",
    () =>
      Effect.promise(async () => {
        const { draft, index, metadataCache, vault, workspace } =
          await makeHarness({ "draft.md": "@doe2024." });
        const snapshots: CitedBySnapshot[] = [];
        index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));
        workspace.layoutReady();
        await index.whenIndexed();
        const release = vault.hold(draft.path);

        await index.reset();

        await expect.poll(() => vault.reads.at(-1)).toBe(draft.path);
        metadataCache.change(draft, "@roe2025.");

        await expect.poll(() => snapshots.at(-1)?.groups).toEqual([]);

        release();
        await index.whenIndexed();
        await expect.poll(() => snapshots.at(-1)?.groups).toEqual([]);
      }),
  );

  it.effect(
    "recomputes reverse facts without body reads or reverse writes",
    () =>
      Effect.promise(async () => {
        const { index, metadataCache, store, vault, workspace } =
          await makeHarness({ "draft.md": "@doe2024." });
        const snapshots: CitedBySnapshot[] = [];
        let observed: PromiseWithResolvers<void> | undefined;
        index.observeCitedBy(
          KEY_A,
          (snapshot) => snapshots.push(snapshot),
          () => {
            observed?.resolve();
            return true;
          },
        );
        workspace.layoutReady();
        await index.whenIndexed();
        await expect.poll(() => snapshots.at(-1)?.groups).toHaveLength(1);
        observed = Promise.withResolvers<void>();
        vault.reads.length = 0;
        store.writes.length = 0;

        metadataCache.resolve(metadataCache.files.get("Doe 2024.md")!);

        await observed.promise;
        expect(vault.reads).toEqual([]);
        expect(store.writes).toEqual([]);
        expect(snapshots.at(-1)?.groups).toHaveLength(1);
      }),
  );

  it.effect("adds, moves, and removes citing notes as vault facts change", () =>
    Effect.promise(async () => {
      const { index, metadataCache, vault, workspace } = await makeHarness({});
      const snapshots: CitedBySnapshot[] = [];
      index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));
      workspace.layoutReady();
      await index.whenIndexed();

      const created = new TFile();
      created.path = "created.md";
      created.name = "created.md";
      created.basename = "created";
      created.extension = "md";
      created.stat = { ctime: 0, mtime: 0, size: 0 };
      metadataCache.change(created, "@doe2024.");

      await expect
        .poll(() => snapshots.at(-1)?.groups.map(({ path }) => path))
        .toEqual(["created.md"]);

      vault.rename(created, "Folder/moved.md");

      await expect
        .poll(() => snapshots.at(-1)?.groups.map(({ path }) => path))
        .toEqual(["Folder/moved.md"]);

      vault.deleteFile(created);

      await expect.poll(() => snapshots.at(-1)?.groups).toEqual([]);
    }),
  );

  it.effect(
    "suppresses identical snapshots and isolates observer failures",
    () =>
      Effect.promise(async () => {
        let scanStarted:
          | ReturnType<typeof Promise.withResolvers<void>>
          | undefined;
        let observed:
          | ReturnType<typeof Promise.withResolvers<void>>
          | undefined;
        const { draft, lookup, index, metadataCache, workspace } =
          await makeHarness(
            { "draft.md": "@doe2024." },
            {
              parseClient: {
                parse(request, signal) {
                  scanStarted?.resolve();
                  return inProcessParseClient.parse(request, signal);
                },
              },
            },
          );
        let publications = 0;
        index.observeCitedBy(KEY_A, () => {
          throw new Error("observer failed");
        });
        index.observeCitedBy(
          KEY_A,
          () => publications++,
          () => {
            observed?.resolve();
            return true;
          },
        );
        workspace.layoutReady();
        await index.whenIndexed();
        await expect.poll(() => publications).toBeGreaterThan(0);
        await lookup.read({ citekeys: ["doe2024"] });

        const before = publications;
        scanStarted = Promise.withResolvers<void>();
        observed = Promise.withResolvers<void>();

        metadataCache.change(draft, "@doe2024.");

        await scanStarted.promise;
        await index.getFileScan(draft);
        await observed.promise;
        expect(publications).toBe(before);
      }),
  );

  it.effect(
    "#1705 follows lookup status until the observation is disposed",
    () =>
      Effect.promise(async () => {
        await using h = await createCitationIndexHarness({});
        const snapshots: CitedBySnapshot[] = [];
        const stop = h.index.observeCitedBy(KEY_A, (snapshot) =>
          snapshots.push(snapshot),
        );
        try {
          await expect.poll(() => snapshots.at(-1)?.resolution).toBe("fresh");

          h.citekeys.error = new Error("database read failed");
          h.db.changed();
          await h.lookup.whenResolved();
          await expect.poll(() => snapshots.at(-1)?.resolution).toBe("failed");

          stop();
          const before = snapshots.length;
          h.citekeys.error = null;
          h.db.changed();
          await h.lookup.whenResolved();
          expect(h.lookup.status).toBe("fresh");
          expect(snapshots).toHaveLength(before);
        } finally {
          stop();
        }
      }),
  );

  it.effect("does not publish an observation after its disposer runs", () =>
    Effect.promise(async () => {
      const { index, workspace, metadataCache, draft } = await makeHarness({
        "draft.md": "@doe2024.",
      });
      let publications = 0;
      const stop = index.observeCitedBy(KEY_A, () => publications++);
      workspace.layoutReady();
      await index.whenIndexed();
      await expect.poll(() => publications).toBeGreaterThan(0);
      const before = publications;

      metadataCache.change(draft, "@roe2025.");
      stop();
      await index.getFileScan(draft);
      expect(publications).toBe(before);
    }),
  );

  it.effect("resolves with a Literature Note's path as linkpath", () =>
    Effect.promise(async () => {
      const { draft, index } = await makeHarness({
        "draft.md": "As @doe2024 wrote.",
      });

      expect(await citationsOf(index, draft)).toMatchObject([
        { indexedKey: KEY_A, linkpath: "Doe 2024.md" },
      ]);
    }),
  );
});

describe("CitationIndex documentOmittedSyntaxes", () => {
  it.effect(
    "reports no omitted syntax for a document with no citations at all",
    () =>
      Effect.promise(async () => {
        const { draft, index } = await makeHarness({
          "draft.md": "Plain text.",
        });

        expect(await index.documentOmittedSyntaxes(draft)).toEqual([]);
      }),
  );

  it.effect(
    "reports citekey when Pandoc citations is off and the document scans one",
    () =>
      Effect.promise(async () => {
        const { draft, index } = await makeHarness(
          { "draft.md": "As @doe2024 wrote." },
          { settings: { "citation.pandoc-citations": false } },
        );

        expect(await index.documentOmittedSyntaxes(draft)).toEqual(["citekey"]);
      }),
  );

  it.effect(
    "reports wikilink when Wikilink citations is off and an eligible link resolves",
    () =>
      Effect.promise(async () => {
        const { draft, index, metadataCache } = await makeHarness({
          "draft.md": "See [[Doe 2024]].",
        });
        metadataCache.fileCache.set("draft.md", {
          links: [link("Doe 2024", 4)],
        } as CachedMetadata);

        expect(await index.documentOmittedSyntaxes(draft)).toEqual([
          "wikilink",
        ]);
      }),
  );

  it.effect(
    "reports wikilink when a document holds included citekey citations and an excluded wikilink that resolves",
    () =>
      Effect.promise(async () => {
        const body = "As @doe2024 wrote. See [[Roe 2025]] too.";
        const { draft, index, metadataCache } = await makeHarness({
          "draft.md": body,
        });
        metadataCache.fileCache.set("draft.md", {
          links: [link("Roe 2025", body.indexOf("[["))],
        } as CachedMetadata);

        expect(await index.documentOmittedSyntaxes(draft)).toEqual([
          "wikilink",
        ]);
      }),
  );

  it.effect(
    "reports wikilink when a malformed Citation Fragment still resolves",
    () =>
      Effect.promise(async () => {
        const body = "Bad [[Doe 2024#cite:locator=]].";
        const { draft, index, metadataCache } = await makeHarness({
          "draft.md": body,
        });
        metadataCache.fileCache.set("draft.md", {
          links: [link("Doe 2024#cite:locator=", body.indexOf("[["))],
        } as CachedMetadata);

        expect(await index.documentOmittedSyntaxes(draft)).toEqual([
          "wikilink",
        ]);
      }),
  );

  it.effect(
    "reports no omitted syntax when the only wikilink resolves to no Item",
    () =>
      Effect.promise(async () => {
        const { draft, index, metadataCache } = await makeHarness({
          "draft.md": "See [[ordinary]].",
          "ordinary.md": "",
        });
        metadataCache.fileCache.set("draft.md", {
          links: [link("ordinary", 4)],
        } as CachedMetadata);

        expect(await index.documentOmittedSyntaxes(draft)).toEqual([]);
      }),
  );

  it.effect(
    "reports both syntaxes when both are excluded and both hold occurrences",
    () =>
      Effect.promise(async () => {
        const body = "See @doe2024 and [[Roe 2025]].";
        const { draft, index, metadataCache } = await makeHarness(
          { "draft.md": body },
          {
            settings: {
              "citation.pandoc-citations": false,
              "citation.wikilink-citations": false,
            },
          },
        );
        metadataCache.fileCache.set("draft.md", {
          links: [link("Roe 2025", body.indexOf("[["))],
        } as CachedMetadata);

        expect(await index.documentOmittedSyntaxes(draft)).toEqual([
          "citekey",
          "wikilink",
        ]);
      }),
  );
});

describe("CitationIndex citedByOmittedSyntaxes", () => {
  it.effect(
    "reports [] when groups is non-empty and holds no excluded occurrence",
    () =>
      Effect.promise(async () => {
        const { index, workspace } = await makeHarness({
          "draft.md": "@doe2024.",
        });
        workspace.layoutReady();
        await index.whenIndexed();

        expect(await index.getCitedBy(KEY_A)).toMatchObject({
          groups: [{ path: "draft.md" }],
        });
        expect(await index.citedByOmittedSyntaxes(KEY_A)).toEqual([]);
      }),
  );

  it.effect(
    "reports the excluded syntax when a non-empty answer's item also has occurrences of it",
    () =>
      Effect.promise(async () => {
        const body = "As @doe2024 wrote. See [[Doe 2024]] too.";
        const { index, metadataCache, workspace } = await makeHarness({
          "draft.md": body,
        });
        metadataCache.fileCache.set("draft.md", {
          links: [link("Doe 2024", body.indexOf("[["))],
        } as CachedMetadata);
        workspace.layoutReady();
        await index.whenIndexed();

        // The citekey occurrence still joins the group; the wikilink occurrence
        // of the same item does not, since wikilink citations are excluded by
        // default — the case a short answer must still name.
        expect(await index.getCitedBy(KEY_A)).toMatchObject({
          groups: [{ path: "draft.md" }],
        });
        expect(await index.citedByOmittedSyntaxes(KEY_A)).toEqual(["wikilink"]);
      }),
  );

  it.effect("reports [] when nothing cites the item at all", () =>
    Effect.promise(async () => {
      const { index, workspace } = await makeHarness({
        "draft.md": "@roe2025.",
      });
      workspace.layoutReady();
      await index.whenIndexed();

      expect(await index.getCitedBy(KEY_A)).toMatchObject({ groups: [] });
      expect(await index.citedByOmittedSyntaxes(KEY_A)).toEqual([]);
    }),
  );

  it.effect(
    "reports citekey when it is excluded and its occurrence resolves to the queried item",
    () =>
      Effect.promise(async () => {
        const { index, workspace } = await makeHarness(
          { "draft.md": "@doe2024." },
          { settings: { "citation.pandoc-citations": false } },
        );
        workspace.layoutReady();
        await index.whenIndexed();

        expect(await index.getCitedBy(KEY_A)).toMatchObject({ groups: [] });
        expect(await index.citedByOmittedSyntaxes(KEY_A)).toEqual(["citekey"]);
      }),
  );

  it.effect(
    "reports wikilink for an eligible occurrence, not for a malformed one",
    () =>
      Effect.promise(async () => {
        const body = "See [[Doe 2024#cite:locator=]].";
        const { index, metadataCache, workspace } = await makeHarness({
          "draft.md": body,
        });
        metadataCache.fileCache.set("draft.md", {
          links: [link("Doe 2024#cite:locator=", body.indexOf("[["))],
        } as CachedMetadata);
        workspace.layoutReady();
        await index.whenIndexed();

        // The occurrence is malformed, so it never would have joined a group:
        // unlike a references answer, cited-by counts only eligible occurrences.
        expect(await index.getCitedBy(KEY_A)).toMatchObject({ groups: [] });
        expect(await index.citedByOmittedSyntaxes(KEY_A)).toEqual([]);
      }),
  );

  it.effect(
    "scopes the omission to the queried item, not any item an excluded syntax cites",
    () =>
      Effect.promise(async () => {
        const body = "See [[Roe 2025]].";
        const { index, metadataCache, workspace } = await makeHarness({
          "draft.md": body,
        });
        metadataCache.fileCache.set("draft.md", {
          links: [link("Roe 2025", body.indexOf("[["))],
        } as CachedMetadata);
        workspace.layoutReady();
        await index.whenIndexed();

        // Wikilink citations is off, and an excluded wikilink cites KEY_B — but
        // the queried item is KEY_A, which nobody cites at all.
        expect(await index.getCitedBy(KEY_A)).toMatchObject({ groups: [] });
        expect(await index.citedByOmittedSyntaxes(KEY_A)).toEqual([]);
        expect(await index.getCitedBy(KEY_B)).toMatchObject({ groups: [] });
        expect(await index.citedByOmittedSyntaxes(KEY_B)).toEqual(["wikilink"]);
      }),
  );
});

describe("CitationIndex one-shot reads", () => {
  it.effect.each([
    {
      enabled: true,
      expected: {
        groups: [{ path: "draft.md", occurrences: [{ raw: "doe2024" }] }],
      },
    },
    { enabled: false, expected: ["citekey"] },
  ])(
    "keeps the requested occurrences while a lookup waits (Pandoc enabled: $enabled)",
    ({ enabled, expected }) =>
      Effect.promise(async () => {
        const db = new DatabaseStub({ readyImmediately: false });
        const { index, workspace, metadataCache, draft } = await makeHarness(
          { "draft.md": "@doe2024." },
          { db, settings: { "citation.pandoc-citations": enabled } },
        );
        workspace.layoutReady();
        await index.whenIndexed();
        const pending = enabled
          ? index.getCitedBy(KEY_A)
          : index.citedByOmittedSyntaxes(KEY_A);

        metadataCache.change(draft, "@roe2025.");
        db.settle();

        expect(await pending).toMatchObject(expected);
      }),
  );

  it.effect("answers the reverse observation as a single read", () =>
    Effect.promise(async () => {
      const { index, workspace } = await makeHarness({
        "review.md": "@doe2024 and @roe2025.",
      });

      workspace.layoutReady();
      await index.whenIndexed();

      expect(await index.getCitedBy(KEY_A)).toMatchObject({
        coverage: "complete",
        resolution: "fresh",
        groups: [{ path: "review.md", occurrences: [{ raw: "doe2024" }] }],
      });
    }),
  );

  it.effect("times out while coverage stays transitional, then settles", () =>
    Effect.gen(function* () {
      const context = yield* Effect.context<never>();
      const { index, workspace } = yield* Effect.promise(() =>
        makeHarness({ "review.md": "@doe2024." }, { context }),
      );
      let outcome: string | undefined;
      const pending = index.waitUntilSettled(60_000).then((value) => {
        outcome = value;
      });
      yield* TestClock.adjust(60_001);
      expect(outcome).toBe("timeout");
      yield* Effect.promise(() => pending);
      workspace.layoutReady();
      expect(yield* Effect.promise(() => index.waitUntilSettled(1_000))).toBe(
        "settled",
      );
      expect(
        (yield* Effect.promise(() => index.getCitedBy(KEY_A))).coverage,
      ).toBe("complete");
    }),
  );

  it.effect("counts a degraded resolution as settled", () =>
    Effect.promise(async () => {
      const db = new DatabaseStub();
      db.state = "degraded";
      const { index, workspace } = await makeHarness(
        { "review.md": "@doe2024." },
        { db, notes: false },
      );

      workspace.layoutReady();
      await expect(index.waitUntilSettled(1_000)).resolves.toBe("settled");
      await expect(index.getCitedBy(KEY_A)).rejects.toThrow();
    }),
  );
});

describe("CitationIndex ambiguous citation keys", () => {
  it.effect(
    "keeps an ambiguous literal citation under its own Citation Key",
    () =>
      Effect.promise(async () => {
        const { draft, index } = await makeHarness(
          { "draft.md": "As @doe2024 wrote." },
          { notes: false, citekeys: [myLibraryRow, sameLibraryTwin] },
        );

        expect(await citationsOf(index, draft)).toMatchObject([
          { indexedKey: null, linkpath: null, refNumber: 1 },
        ]);
      }),
  );

  // The occurrence may cite either Item, so the reverse observation reports the
  // possible relationship for each rather than omitting it from both.
  it.effect("attributes one ambiguous occurrence to every candidate", () =>
    Effect.promise(async () => {
      const { draft, index, workspace } = await makeHarness(
        { "draft.md": "As @doe2024 wrote." },
        {
          notes: false,
          citekeys: [myLibraryRow, groupTwin],
          libraryScope: bothLibraries(),
        },
      );
      workspace.layoutReady();
      await index.whenIndexed();

      for (const indexedKey of [KEY_A, GROUP_KEY]) {
        expect((await index.getCitedBy(indexedKey)).groups).toMatchObject([
          { path: draft.path, occurrences: [{ raw: "doe2024" }] },
        ]);
      }
    }),
  );

  // One source occurrence stays one Citation of the key itself, however many
  // Items the reverse observation attributes it to.
  it.effect("creates no Citation record per candidate", () =>
    Effect.promise(async () => {
      const { draft, index } = await makeHarness(
        { "draft.md": "As @doe2024 wrote, and @doe2024 again." },
        {
          notes: false,
          citekeys: [myLibraryRow, groupTwin],
          libraryScope: bothLibraries(),
        },
      );

      const citations = await citationsOf(index, draft);

      expect(citations).toMatchObject([{ indexedKey: null, refNumber: 1 }]);
      expect(citations[0]!.occurrences).toHaveLength(2);
    }),
  );

  it.effect(
    "stops attributing the occurrence once the scope narrows to one candidate",
    () =>
      Effect.promise(async () => {
        const libraryScope = bothLibraries();
        const { lookup, index, workspace } = await makeHarness(
          { "draft.md": "As @doe2024 wrote." },
          { notes: false, citekeys: [myLibraryRow, groupTwin], libraryScope },
        );
        workspace.layoutReady();
        await index.whenIndexed();
        expect((await index.getCitedBy(GROUP_KEY)).groups).toHaveLength(1);

        libraryScope.select([personalLibrary()]);
        await lookup.whenResolved();

        expect((await index.getCitedBy(GROUP_KEY)).groups).toStrictEqual([]);
        expect((await index.getCitedBy(KEY_A)).groups).toHaveLength(1);
      }),
  );
});

/** Runs one index to completion over `documents`, leaving its scans in `store`. */
async function warmVault(
  documents: Record<string, string>,
  store: MemoryStore,
): Promise<void> {
  const { index, workspace, closeIndex } = await makeHarness(documents, {
    store,
  });
  workspace.layoutReady();
  await index.whenIndexed();
  await closeIndex();
}

async function makeHarness(
  documents: Record<string, string>,
  options: CitationIndexHarnessOptions = {},
): Promise<CitationIndexHarness> {
  const harness = await createCitationIndexHarness(documents, options);
  harnesses.push(harness);
  return harness;
}
