// The vault properties of the Query View as the vault answers them: the
// frontmatter of an Item's Literature Note, by the Note Index, or of the note
// that holds the view.
import type { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createObsidianHost } from "@/lib/__fixtures__/obsidian-host";
import { Effect } from "@/lib/effect";
import * as m from "@/lib/i18n/generated/messages";
import type { CreationProfileSelection } from "@/services/note-feature/operations";
import { NoteIndexStub } from "@/services/note-index/test-stub";
import { chooseLiteratureNoteProfile } from "@/views/quick-switch/profile-picker";

import { literatureNotes } from "./table-notes";
import type { LiteratureNotesDeps } from "./table-notes";

/** The text of each notice shown. */
const notices = vi.hoisted((): string[] => []);
vi.mock("obsidian", async (importOriginal) => {
  const obsidian = await importOriginal<typeof import("obsidian")>();
  return {
    ...obsidian,
    Notice: class extends obsidian.Notice {
      constructor(message: string | DocumentFragment, duration?: number) {
        super(message, duration);
        notices.push(
          typeof message === "string" ? message : (message.textContent ?? ""),
        );
      }
    },
  };
});
vi.mock("@/views/annot-view/register", () => ({
  activateAnnotView: vi.fn(),
}));
vi.mock("@/views/quick-switch/profile-picker", () => ({
  chooseLiteratureNoteProfile: vi.fn(),
}));

/** A vault of notes by path, each with its frontmatter. */
function setup(
  frontmatter: Record<string, Record<string, unknown>>,
  index: Record<string, { path: string }[]>,
  {
    names = [],
    types,
  }: {
    names?: readonly string[];
    /** The types Obsidian assigns, by name; none for a build without them. */
    types?: Record<string, string>;
  } = {},
) {
  const noteIndex = new NoteIndexStub(index, names);
  const typesChanged = new Set<() => void>();
  const getCache = vi.fn((path: string) =>
    path in frontmatter ? { frontmatter: frontmatter[path] } : null,
  );
  const deps = {
    app: {
      metadataCache: { getCache },
      ...(types && {
        metadataTypeManager: {
          getAssignedWidget: (name: string) => types[name] ?? null,
          on: (_event: string, cb: () => void) => {
            typesChanged.add(cb);
            return cb;
          },
          offref: (cb: () => void) => typesChanged.delete(cb),
        },
      }),
    },
    noteIndex,
  } as unknown as LiteratureNotesDeps;
  /** Assign `widget` to `name`, as the Properties panel does. */
  const setType = (name: string, widget: string) => {
    types![name] = widget;
    for (const cb of typesChanged) cb();
  };
  return { notes: literatureNotes(deps), noteIndex, getCache, setType };
}

describe("literatureNotes vault properties", () => {
  it("reads a key from the Item's first Literature Note", () => {
    const { notes } = setup(
      {
        "Doe 2024.md": { status: "reading" },
        "Doe 2024 (old).md": { status: "read" },
      },
      { ITEMAAAA: [{ path: "Doe 2024.md" }, { path: "Doe 2024 (old).md" }] },
    );

    expect(notes.read("ITEMAAAA", "status", null)).toEqual({
      note: true,
      value: "reading",
    });
  });

  it("tells an Item with no Literature Note from a note without the key", () => {
    const { notes } = setup(
      { "Doe 2024.md": { other: 1 } },
      { ITEMAAAA: [{ path: "Doe 2024.md" }] },
    );

    expect(notes.read("ITEMBBBB", "status", null)).toEqual({ note: false });
    expect(notes.read("ITEMAAAA", "status", null)).toEqual({
      note: true,
      value: null,
    });
  });

  it("reads the note that holds the view for its own Item, whatever the index ranks first", () => {
    const { notes } = setup(
      {
        "Doe 2024.md": { status: "reading" },
        "Doe 2024 (copy).md": { status: "read" },
      },
      {
        ITEMAAAA: [{ path: "Doe 2024.md" }, { path: "Doe 2024 (copy).md" }],
        ITEMBBBB: [{ path: "Doe 2024.md" }],
      },
    );
    const host = { path: "Doe 2024 (copy).md", itemKey: "ITEMAAAA" };

    expect(notes.read("ITEMAAAA", "status", host)).toEqual({
      note: true,
      value: "read",
    });
    // Another Item's row reads that Item's own note.
    expect(notes.read("ITEMBBBB", "status", host)).toEqual({
      note: true,
      value: "reading",
    });
  });

  it("lists the property names of the Literature Notes, without the Literature Note Property", () => {
    const { notes } = setup(
      {},
      {},
      { names: ["literatureNote", "rating", "status"] },
    );

    expect(notes.propertyNames()).toEqual(["rating", "status"]);
  });

  it("infers the type of a property from its first value", () => {
    const { notes } = setup(
      {
        "A.md": { status: null, pages: 12, read: true, due: "2024-05-01" },
        "B.md": { status: ["a", "b"], title: "x" },
      },
      { ITEMAAAA: [{ path: "A.md" }], ITEMBBBB: [{ path: "B.md" }] },
    );

    expect(notes.propertyType("status")).toBe("multitext");
    expect(notes.propertyType("pages")).toBe("number");
    expect(notes.propertyType("read")).toBe("checkbox");
    expect(notes.propertyType("due")).toBe("date");
    expect(notes.propertyType("title")).toBe("text");
    expect(notes.propertyType("missing")).toBe("text");
  });

  it("infers a date and time without seconds, as Obsidian does", () => {
    const { notes } = setup(
      { "A.md": { at: "2024-05-01T10:30", stamp: "2024-05-01T10:30:00" } },
      { ITEMAAAA: [{ path: "A.md" }] },
    );

    expect(notes.propertyType("at")).toBe("datetime");
    expect(notes.propertyType("stamp")).toBe("text");
  });

  it("takes the type Obsidian assigns a property over the one its values show", () => {
    const { notes } = setup(
      { "A.md": { pages: "12", due: "soon", tags2: "x", stamp: "a" } },
      { ITEMAAAA: [{ path: "A.md" }] },
      {
        types: {
          pages: "number",
          due: "date",
          tags2: "multitext",
          stamp: "datetime",
          read: "checkbox",
          cover: "file",
        },
      },
    );

    expect(notes.propertyType("pages")).toBe("number");
    expect(notes.propertyType("due")).toBe("date");
    expect(notes.propertyType("tags2")).toBe("multitext");
    expect(notes.propertyType("stamp")).toBe("datetime");
    expect(notes.propertyType("read")).toBe("checkbox");
    // A type ZotLit has no editor for falls back to the values.
    expect(notes.propertyType("cover")).toBe("text");
  });

  it("reads the notes once for the types until a frontmatter changes", () => {
    const frontmatter: Record<string, Record<string, unknown>> = {
      "A.md": { pages: 12 },
    };
    const { notes, noteIndex, getCache } = setup(frontmatter, {
      ITEMAAAA: [{ path: "A.md" }],
    });
    // Read before any listener, as a view's first render reads.
    notes.propertyType("pages");
    notes.propertyType("pages");
    notes.propertyType("other");
    expect(getCache).toHaveBeenCalledTimes(1);

    const seen: string[] = [];
    const off = notes.on("frontmatter-changed", () =>
      seen.push(notes.propertyType("pages")),
    );

    frontmatter["A.md"] = { pages: "twelve" };
    noteIndex.emit("frontmatter-changed");
    off();

    // A listener reads the change, not the type from before it.
    expect(seen).toEqual(["text"]);
  });

  it("reads the notes again when a Literature Note is added", () => {
    const frontmatter: Record<string, Record<string, unknown>> = {};
    const index: Record<string, { path: string }[]> = {};
    const { notes, noteIndex } = setup(frontmatter, index);
    const off = notes.on("changed", () => {});

    expect(notes.propertyType("pages")).toBe("text");
    frontmatter["A.md"] = { pages: 12 };
    index.ITEMAAAA = [{ path: "A.md" }];
    noteIndex.emit("changed");

    expect(notes.propertyType("pages")).toBe("number");
    off();
  });

  it("tells a change of an assigned type as a frontmatter change, and reads it", () => {
    const { notes, setType } = setup(
      { "A.md": { pages: "12" } },
      { ITEMAAAA: [{ path: "A.md" }] },
      { types: {} },
    );
    const seen: string[] = [];
    const off = notes.on("frontmatter-changed", () =>
      seen.push(notes.propertyType("pages")),
    );

    expect(notes.propertyType("pages")).toBe("text");
    setType("pages", "number");
    off();
    setType("pages", "text");

    expect(seen).toEqual(["number"]);
  });

  it("tells a frontmatter change of a Literature Note", () => {
    const { notes, noteIndex } = setup({}, {});
    const listener = vi.fn();
    const off = notes.on("frontmatter-changed", listener);

    noteIndex.emit("frontmatter-changed");
    off();
    noteIndex.emit("frontmatter-changed");

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("literatureNotes vault property writes", () => {
  afterEach(() => {
    vi.mocked(chooseLiteratureNoteProfile).mockReset();
    notices.length = 0;
  });
  /** A vault of notes on disk, the Note Index over them, and Profiles that manage keys. */
  function vault(
    files: Record<string, string>,
    index: Record<string, { path: string }[]>,
    {
      managed = {},
      selection = { selector: "default", source: "bound", shouldAsk: false },
    }: {
      /** The keys each Profile manages, by its template's name. */
      managed?: Record<string, { key?: string; merge: string }[]>;
      /** The Profile the usual creation resolves for an Item. */
      selection?: CreationProfileSelection;
    } = {},
  ) {
    const host = createObsidianHost(files);
    const noteIndex = new NoteIndexStub(index);
    const profileOf = vi.fn((file?: TFile) => {
      const stamp = file
        ? host.metadataCache.getFileCache(file)?.frontmatter?.["zotlit-profile"]
        : undefined;
      return {
        ok: true,
        profile: {
          document: stamp === undefined ? undefined : `${stamp}.md`,
        },
      };
    });
    /** The usual creation: a note at `<key>.md`, as the Profile's template writes it. */
    const createNote = vi.fn(async (item: { indexedKey: string }) => ({
      outcome: "created" as const,
      file: host.vault.createFile(
        `${item.indexedKey}.md`,
        `---\nzotero-key: ${item.indexedKey}\n---\n`,
      ),
    }));
    const deps = {
      app: {
        ...host.app,
        metadataCache: {
          getFileCache: (file: TFile) => host.metadataCache.getFileCache(file),
          getCache: (path: string) =>
            host.metadataCache.getFileCache(host.file(path)),
        },
      },
      noteIndex,
      profile: {
        profileOf,
      },
      template: {
        frontmatterFields: managed.legacy ?? [],
        getLiteratureNoteTemplate: (document: string) => {
          const entries = managed[document.replace(/\.md$/, "")];
          return entries && { frontmatter: { compiled: entries } };
        },
      },
      zoteroReads: {
        ready: Promise.resolve({
          reads: {
            ItemsByIndexedKeys: ({ indexedKeys }: { indexedKeys: string[] }) =>
              Effect.succeed(
                new Map(
                  indexedKeys.map((key) => [key, { indexedKey: key, key }]),
                ),
              ),
          },
        }),
      },
      zoteroPref: { dataDir: null },
      noteFeature: {
        createNote,
        resolveCreationProfile: async () => selection,
        prepareCreationProfiles: async (item: { indexedKey: string }) => [
          {
            selector: "default",
            label: undefined,
            path: `${item.indexedKey}.md`,
            create: () => createNote(item),
          },
        ],
      },
    } as unknown as LiteratureNotesDeps;
    return {
      host,
      noteIndex,
      profileOf,
      notes: literatureNotes(deps),
      createNote,
    };
  }

  it("writes only the edited key of the Item's Literature Note", async () => {
    const { host, notes } = vault(
      {
        "A.md":
          "---\nzotero-key: ITEMAAAA\ntitle: Rules\nstatus: unread\nrating: 3\n---\nBody\n",
      },
      { ITEMAAAA: [{ path: "A.md" }] },
    );

    await expect(
      notes.write({
        itemKey: "ITEMAAAA",
        name: "status",
        value: "read",
        host: null,
      }),
    ).resolves.toBe("written");

    expect(host.text("A.md")).toBe(
      "---\nzotero-key: ITEMAAAA\ntitle: Rules\nstatus: read\nrating: 3\n---\nBody\n",
    );
  });

  it("writes an open note in its editor", async () => {
    const { host, notes } = vault(
      { "A.md": "---\nstatus: unread\n---\nSaved\n" },
      { ITEMAAAA: [{ path: "A.md" }] },
    );
    const editor = host.openInEditor(host.file("A.md"));
    editor.edit("---\nstatus: unread\n---\nTyped\n");

    await notes.write({
      itemKey: "ITEMAAAA",
      name: "status",
      value: "read",
      host: null,
    });

    expect(editor.getViewData()).toBe("---\nstatus: read\n---\nTyped\n");
  });

  it("keeps a cleared key, with no value", async () => {
    const { host, notes } = vault(
      { "A.md": "---\nstatus: unread\nrating: 3\n---\n" },
      { ITEMAAAA: [{ path: "A.md" }] },
    );

    await notes.write({
      itemKey: "ITEMAAAA",
      name: "status",
      value: null,
      host: null,
    });

    expect(
      host.metadataCache.getFileCache(host.file("A.md"))?.frontmatter,
    ).toEqual({ status: null, rating: 3 });
  });

  it("writes the note that holds the view for its own Item", async () => {
    const { host, notes } = vault(
      {
        "A.md": "---\nstatus: unread\n---\n",
        "A (copy).md": "---\nstatus: unread\n---\n",
      },
      { ITEMAAAA: [{ path: "A.md" }, { path: "A (copy).md" }] },
    );

    await notes.write({
      itemKey: "ITEMAAAA",
      name: "status",
      value: "read",
      host: {
        path: "A (copy).md",
        itemKey: "ITEMAAAA",
      },
    });

    expect(host.text("A (copy).md")).toBe("---\nstatus: read\n---\n");
    expect(host.text("A.md")).toBe("---\nstatus: unread\n---\n");
  });

  it("creates the Literature Note of an Item with none, then writes the key to it", async () => {
    const { host, notes, createNote } = vault({}, {});

    await expect(
      notes.write({
        itemKey: "ITEMAAAA",
        name: "status",
        value: "read",
        host: null,
      }),
    ).resolves.toBe("created");

    expect(createNote).toHaveBeenCalledOnce();
    expect(chooseLiteratureNoteProfile).not.toHaveBeenCalled();
    expect(host.text("ITEMAAAA.md")).toBe(
      "---\nzotero-key: ITEMAAAA\nstatus: read\n---\n",
    );
    await vi.waitFor(() => expect(notices).toEqual([m.notice_created_note()]));
  });

  describe("where several Profiles fit the Item", () => {
    const ask: CreationProfileSelection = {
      selector: "default",
      source: "headless",
      shouldAsk: true,
    };
    const edit = {
      itemKey: "ITEMAAAA",
      name: "status",
      value: "read",
      host: null,
    };

    it("asks for the Profile, then creates the note under it and writes the key", async () => {
      vi.mocked(chooseLiteratureNoteProfile).mockResolvedValueOnce({
        id: "default",
        label: "Default",
      } as never);
      const { host, notes } = vault({}, {}, { selection: ask });

      await expect(notes.write(edit)).resolves.toBe("created");

      expect(chooseLiteratureNoteProfile).toHaveBeenCalledOnce();
      expect(host.text("ITEMAAAA.md")).toBe(
        "---\nzotero-key: ITEMAAAA\nstatus: read\n---\n",
      );
    });

    it("creates and writes nothing when the prompt is cancelled", async () => {
      vi.mocked(chooseLiteratureNoteProfile).mockResolvedValueOnce(undefined);
      const { host, notes, createNote } = vault({}, {}, { selection: ask });

      await expect(notes.write(edit)).resolves.toBe("cancelled");

      expect(createNote).not.toHaveBeenCalled();
      expect(host.vault.getMarkdownFiles()).toEqual([]);
    });
  });

  it("tells a key the note's own Profile replaces from one it keeps, appends or leaves alone", () => {
    const { notes } = vault(
      {
        "A.md": "---\nzotlit-profile: Books\n---\n",
        "B.md": "---\nzotlit-profile: Papers\n---\n",
        "C.md": "---\n---\n",
      },
      {
        ITEMAAAA: [{ path: "A.md" }],
        ITEMBBBB: [{ path: "B.md" }],
        ITEMCCCC: [{ path: "C.md" }],
      },
      {
        managed: {
          Books: [
            { key: "status", merge: "replace" },
            { key: "topics", merge: "append" },
            { key: "rating", merge: "keep" },
            { merge: "replace" },
          ],
          Papers: [],
          legacy: [{ key: "rating", merge: "replace" }],
        },
      },
    );

    expect(notes.managed("ITEMAAAA", "status", null)).toBe(true);
    expect(notes.managed("ITEMAAAA", "topics", null)).toBe(false);
    expect(notes.managed("ITEMAAAA", "rating", null)).toBe(false);
    expect(notes.managed("ITEMAAAA", "other", null)).toBe(false);
    // The same key on a note of another Profile.
    expect(notes.managed("ITEMBBBB", "status", null)).toBe(false);
    // A note with no stamp, under the default Profile's own fields.
    expect(notes.managed("ITEMCCCC", "rating", null)).toBe(true);
    // No note: nothing manages the key.
    expect(notes.managed("ITEMDDDD", "status", null)).toBe(false);
  });

  it("reads a note's Profile once until a note changes", () => {
    const { notes, noteIndex, profileOf } = vault(
      { "A.md": "---\nzotlit-profile: Books\n---\n" },
      { ITEMAAAA: [{ path: "A.md" }] },
      { managed: { Books: [{ key: "status", merge: "replace" }] } },
    );
    expect(notes.managed("ITEMAAAA", "status", null)).toBe(true);
    expect(notes.managed("ITEMAAAA", "rating", null)).toBe(false);
    expect(profileOf).toHaveBeenCalledTimes(1);

    noteIndex.emit("frontmatter-changed");
    notes.managed("ITEMAAAA", "status", null);

    expect(profileOf).toHaveBeenCalledTimes(2);
  });

  it("reads the host note's own Profile for its Item", () => {
    const { notes } = vault(
      {
        "A.md": "---\nzotlit-profile: Papers\n---\n",
        "A (copy).md": "---\nzotlit-profile: Books\n---\n",
      },
      { ITEMAAAA: [{ path: "A.md" }, { path: "A (copy).md" }] },
      { managed: { Books: [{ key: "status", merge: "replace" }], Papers: [] } },
    );

    expect(
      notes.managed("ITEMAAAA", "status", {
        path: "A (copy).md",
        itemKey: "ITEMAAAA",
      }),
    ).toBe(true);
  });
});
