// @vitest-environment happy-dom
// What the Note Preview shows against what the real create path writes: one
// fixture Item, one Profile source, the write captured through a fake vault.
import type { TFile } from "obsidian";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { getItemsByKey } from "@zotlit/db";

import type { SyncRenderDeps } from "@/services/note-feature/context";
import { createNoteFeature } from "@/services/note-feature/operations";
import type { CreateNoteResult } from "@/services/note-feature/operations";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import type { ProfileFixtureSettings } from "@/services/profile/__fixtures__/reader";
import { seedProfileEntry } from "@/services/profile/service";
import { defaults as settingsDefaults } from "@/services/settings/schema";

import {
  createRenderFixture,
  PROFILE_SOURCE,
  SAVED_NOTE,
} from "./__fixtures__/render";
import { renderNativeProfile } from "./render";

const LITERATURE_FOLDER = "notes";

/**
 * The Properties block the fixture Profile and Item must produce, read off the
 * Profile source by hand: `title` from `zt.title`, the appended `tags` value,
 * the `zotero-key` every document preparation stamps, then the Profile stamp
 * (`name (id)`) and the manifest's citation style — in that declared order.
 */
const EXPECTED_BLOCK = `title: Better figures
tags:
  - review
zotero-key: MAIN2345
zotlit-profile: Paper (paper)
zotlit-csl: numeric
`;

/**
 * The real create path over the preview fixture's database and templates, with
 * `vault.create` capturing the bytes a real vault would receive. The Profile
 * entry is seeded from the same manifest the preview renders, exactly as the
 * registry seeds a saved Profile document.
 */
async function realCreate(
  fixture: Awaited<ReturnType<typeof createRenderFixture>>,
  source: string = PROFILE_SOURCE,
): Promise<{
  result: CreateNoteResult;
  written: { path: string; content: string } | undefined;
}> {
  const document =
    fixture.deps.templates.prepareLiteratureNoteTemplateSource(source);
  const entry = seedProfileEntry(document.manifest, {
    document: "zotlit-profile.paper.md",
    path: "templates/zotlit-profile.paper.md",
    libraries: [],
  });
  const current: ProfileFixtureSettings = {
    ...settingsDefaults,
    "note.default-profile": {
      ...settingsDefaults["note.default-profile"],
      bindings: {
        ...settingsDefaults["note.default-profile"].bindings,
        "note.literature-folder": LITERATURE_FOLDER,
      },
    },
    profiles: [entry],
  };
  const captured: { path: string; content: string }[] = [];
  const deps = {
    profile: profileReader(current, { getFileCache: () => null }),
    app: {
      vault: {
        getAbstractFileByPath: () => null,
        getRoot: () => ({ path: "/" }),
        createFolder: async () => ({ path: LITERATURE_FOLDER }),
        create: async (path: string, content: string) => {
          captured.push({ path, content });
          return { path } as TFile;
        },
        process: async () => "",
      },
      fileManager: {
        generateMarkdownLink: (target: { path: string }) =>
          `[[${target.path}]]`,
        processFrontMatter: async () => undefined,
        renameFile: async () => undefined,
      },
      metadataCache: { getFileCache: () => null },
    },
    template: {
      ready: Promise.resolve(),
      loaded: true,
      frontmatterFields: [],
      getLiteratureNoteTemplate: () => document,
      renderProfileAnnotation: () => "",
      renderFilename: (data: object) => document.renderFilename(data),
      render: (name: string, data: object) =>
        fixture.deps.templates.render(name as "note", data),
    },
    db: fixture.deps.db,
    noteIndex: {
      ready: Promise.resolve(),
      whenIndexed: async () => {},
      getNotesByItemKey: () => [],
      getImportedNoteByNoteKey: () => [],
    },
    zoteroPref: { dataDir: "/Zotero", baseAttachmentPath: null },
    settings: {
      current,
      loaded: Promise.resolve(current),
      update: () => current,
    },
    attachmentImport: {
      prepare: async () => ({
        decide: (path: string, origin: string) => ({
          approved: false,
          path,
          origin,
          reason: "no-trusted-root",
        }),
        resolveLink: () => () => "",
        flush: async () => ({
          copied: 0,
          skipped: 0,
          missing: 0,
          blocked: 0,
          refused: 0,
        }),
        discard: () => undefined,
      }),
    },
    noteImport: {
      prepare: async () => ({
        resolveChildNote: () => ({
          key: "",
          indexedKey: "",
          title: null,
          noteLink: () => "",
        }),
        flush: async () => ({ created: 0, skipped: 0, failed: 0 }),
      }),
    },
  } as unknown as SyncRenderDeps;

  using lease = await fixture.deps.db.acquireRead();
  const item = getItemsByKey(lease.client, 1, ["MAIN2345"])[0]!;
  const result = await createNoteFeature(deps).createNote(item, {
    profile: entry.id,
  });
  return { result, written: captured[0] };
}

/** Split written note bytes the way a reader of the file would. */
function splitNote(content: string): { block: string; body: string } {
  const end = content.indexOf("\n---\n", 4);
  return { block: content.slice(4, end + 1), body: content.slice(end + 5) };
}

describe("Note Preview fidelity against the real create path", () => {
  it("shows the filename, Properties block, key order, and body the created note carries", async () => {
    await using fixture = await createRenderFixture();
    const preview = await renderNativeProfile(fixture.deps, {
      source: PROFILE_SOURCE,
      snapshot: fixture.snapshot,
      mode: "create",
    });
    const { result, written } = await realCreate(fixture);

    expect(result.outcome).toBe("created");
    expect(written!.path).toBe(`${LITERATURE_FOLDER}/${preview.filename}.md`);
    const note = splitNote(written!.content);
    expect(note.block).toBe(EXPECTED_BLOCK);
    expect(preview.frontmatterBlock).toBe(note.block);
    expect(Object.keys(parse(preview.frontmatterBlock!) as object)).toEqual([
      "title",
      "tags",
      "zotero-key",
      "zotlit-profile",
      "zotlit-csl",
    ]);
    expect(preview.creationBody).toBe(note.body);
  });

  it("shows the saved note's own Properties in update mode, not the created block", async () => {
    await using fixture = await createRenderFixture({ existing: SAVED_NOTE });
    const update = await renderNativeProfile(fixture.deps, {
      source: PROFILE_SOURCE,
      snapshot: fixture.snapshot,
      mode: "update",
    });
    const { written } = await realCreate(fixture);

    expect(update.creationBody).toBe(
      "Personal introduction.\n\n%%zt-managed%%\nManaged Better figures.\n> [!quote]\n> Use readable figures.\n%%/zt-managed%%\n\nPersonal conclusion.\n",
    );
    expect(update.frontmatterBlock).not.toBe(splitNote(written!.content).block);
    expect(parse(update.frontmatterBlock!)).toEqual({
      title: "Better figures",
      private: "Keep this",
      number: 7,
      tags: ["mine", "review"],
      "zotero-key": "MAIN2345",
      "zotlit-profile": "Paper (paper)",
      "zotlit-csl": "numeric",
    });
  });

  it("keeps rendering a note whose Managed Frontmatter field fails, where create refuses", async () => {
    await using fixture = await createRenderFixture({ javascript: true });
    const source = PROFILE_SOURCE.replace(
      "expr: zt.title",
      "js: zt.missing.deep",
    );
    const preview = await renderNativeProfile(fixture.deps, {
      source,
      snapshot: fixture.snapshot,
      mode: "create",
    });
    const { result, written } = await realCreate(fixture, source);

    expect(preview.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "property-error",
        part: "properties",
        position: 1,
        params: { key: "title" },
      }),
    );
    expect(preview.creationBody).toContain("# Better figures");
    expect(preview.properties.map(({ key }) => key)).toEqual(["tags"]);
    expect(written).toBeUndefined();
    expect(result).toEqual({
      outcome: "refused",
      diagnostic: expect.objectContaining({
        code: "managed-frontmatter-refused",
        failures: [expect.objectContaining({ field: "title" })],
      }),
    });
  });

  it("carries a draft manifest's label and citation style into the preview through the shared resolver", async () => {
    await using fixture = await createRenderFixture({
      defaultStyle: "numeric",
    });
    const draft = await renderNativeProfile(fixture.deps, {
      source: PROFILE_SOURCE.replace("name: Paper", "name: Draft paper")
        .replace("citationStyle: numeric", "citationStyle: author-date")
        .replace("filename:", "folder: Drafts\nfilename:")
        .replace("Personal space.", "See [@figures2014]."),
      snapshot: fixture.snapshot,
      mode: "create",
    });

    expect(draft.diagnostics).toEqual([]);
    expect(parse(draft.frontmatterBlock!)).toMatchObject({
      "zotlit-profile": "Draft paper (paper)",
      "zotlit-csl": "author-date",
    });
    expect(draft.filename).toBe("Better figures");
    expect(fixture.renderCitations).toHaveBeenCalledWith(
      ["[@MAIN2345]"],
      expect.any(Array),
      { styleId: "author-date", locale: null },
    );
  });
});
