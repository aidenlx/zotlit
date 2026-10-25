// The vault properties of the Query View as the vault answers them: the
// frontmatter of an Item's Literature Note, by the Note Index, or of the note
// that holds the view.
import { Stream } from "effect";
import { Effect } from "effect";
import type { App, EventRef, TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Item } from "@zotlit/db";
import { makeItem } from "@zotlit/db/test-utils";

import { testEvent } from "@/lib/__fixtures__/event-stream";
import { createObsidianHost } from "@/lib/__fixtures__/obsidian-host";
import { testRuntime } from "@/lib/__fixtures__/runtime";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { FIELD_ZOTERO_KEY } from "@/lib/constants";
import type {
  CreationPlan,
  CreationProfileSelection,
} from "@/services/note-feature/operations";
import {
  buildNoteIndex,
  cache,
  createNoteHost,
  startup,
} from "@/services/note-index/__fixtures__";
import { stubbedReads } from "@/services/zotero-reads/test-utils";
import { chooseLiteratureNoteProfile } from "@/views/quick-switch/profile-picker";

import { openTextFileView } from "./__fixtures__/open-text-view";
import { literatureNotes } from "./table-notes";
import type { LiteratureNotesDeps } from "./table-notes";

vi.mock("@/views/annot-view/register", () => ({
  activateAnnotView: vi.fn(),
}));
vi.mock("@/views/quick-switch/profile-picker", () => ({
  chooseLiteratureNoteProfile: vi.fn(),
}));

function creationPlans(
  indexedKeys: readonly string[],
  selection: CreationProfileSelection,
  create: (item: {
    indexedKey: string;
  }) => Promise<{ outcome: "created"; file: TFile }>,
): ReadonlyMap<string, CreationPlan> {
  return new Map(
    indexedKeys.map((indexedKey) => {
      const item = { indexedKey, key: indexedKey } as Item;
      return [
        indexedKey,
        {
          item,
          selection,
          previews: [
            {
              selector: "default",
              label: undefined,
              folder: "",
              citationStyle: null,
              document: undefined,
              path: `${indexedKey}.md`,
              create: () => create(item),
            },
          ],
        },
      ];
    }),
  );
}

/** What each test's Note Index holds, released after the test. */
let owned = new AsyncDisposableStack();
afterEach(async () => {
  await owned.disposeAsync();
  owned = new AsyncDisposableStack();
});

/** A Literature Note's frontmatter: the Item key it carries, and its properties. */
const lit = (
  itemKey: string,
  properties: Record<string, unknown> = {},
): Record<string, unknown> => ({ [FIELD_ZOTERO_KEY]: itemKey, ...properties });

/**
 * A vault of notes by path, each with its frontmatter, and the real Note
 * Index over it. `scanned: false` is plugin load during startup: the index
 * holds nothing until `startup(host)`.
 */
async function setup(
  frontmatter: Record<string, Record<string, unknown>>,
  {
    types,
    scanned = true,
  }: {
    /** The types Obsidian assigns, by name; none for a build without them. */
    types?: Record<string, string>;
    scanned?: boolean;
  } = {},
) {
  const host = createNoteHost(
    Object.fromEntries(
      Object.entries(frontmatter).map(([path, properties]) => [
        path,
        cache({ properties }),
      ]),
    ),
    { enabledAtRuntime: scanned },
  );
  const noteIndex = buildNoteIndex(host.app, owned);
  if (scanned) await noteIndex.whenIndexed();
  const typesChanged = new Set<(name: string) => void>();
  const getCache = vi.fn((path: string) => host.metadataCache.getCache(path));
  const deps = stubService<LiteratureNotesDeps>("LiteratureNotesDeps", {
    runtime: testRuntime(),
    app: stubService<LiteratureNotesDeps["app"]>("App", {
      metadataCache: stubService<App["metadataCache"]>("MetadataCache", {
        getCache,
      }),
      metadataTypeManager: types
        ? stubService<NonNullable<App["metadataTypeManager"]>>(
            "MetadataTypeManager",
            {
              getAssignedWidget: (name: string) => types[name] ?? null,
              on: (_event: "changed", callback: (name: string) => void) => {
                typesChanged.add(callback);
                return stubService<EventRef>("EventRef", {});
              },
              offref: (callback: (name: string) => void) =>
                typesChanged.delete(callback),
            },
          )
        : undefined,
    }),
    noteIndex,
    profile: stubService<LiteratureNotesDeps["profile"]>("Profile", {
      changed: Stream.empty,
    }),
    template: stubService<LiteratureNotesDeps["template"]>("Template", {
      "compile-status-changed": Stream.empty,
    }),
    noteFeature: stubService<LiteratureNotesDeps["noteFeature"]>(
      "NoteFeature",
      {
        replacedKeys: async () => new Set(),
      },
    ),
  });
  /** Assign `widget` to `name`, as the Properties panel does. */
  const setType = (name: string, widget: string) => {
    types![name] = widget;
    for (const callback of typesChanged) callback(name);
  };
  /** The note at `path`, created when the vault holds none, now carries `properties`. */
  const write = async (path: string, properties: Record<string, unknown>) => {
    const file = host.vault.files.get(path) ?? host.vault.addFile(path);
    host.metadataCache.change(file, cache({ properties }));
    await noteIndex.whenSettled();
  };
  return { notes: literatureNotes(deps), host, getCache, setType, write };
}

describe("literatureNotes vault properties", () => {
  it("reads a key from the Item's first Literature Note", async () => {
    const { notes, host } = await setup({
      "Doe 2024.md": lit("ITEMAAAA", { status: "reading" }),
      "Doe 2024 (old).md": lit("ITEMAAAA", { status: "read" }),
    });
    // The index ranks the most recently modified note first.
    host.vault.files.get("Doe 2024.md")!.stat.mtime = 1;

    expect(notes.read("ITEMAAAA", "status", null)).toEqual({
      note: true,
      value: "reading",
    });
  });

  it("tells an Item with no Literature Note from a note without the key", async () => {
    const { notes } = await setup({
      "Doe 2024.md": lit("ITEMAAAA", { other: 1 }),
    });

    expect(notes.read("ITEMBBBB", "status", null)).toEqual({ note: false });
    expect(notes.read("ITEMAAAA", "status", null)).toEqual({
      note: true,
      value: null,
    });
  });

  it("reads the note that holds the view for its own Item, whatever the index ranks first", async () => {
    const { notes, host: vault } = await setup({
      "Doe 2024.md": lit("ITEMAAAA", { status: "reading" }),
      "Doe 2024 (copy).md": lit("ITEMAAAA", { status: "read" }),
      "Roe 2025.md": lit("ITEMBBBB", { status: "reading" }),
    });
    // The index ranks the most recently modified note first.
    vault.vault.files.get("Doe 2024.md")!.stat.mtime = 1;
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

  it("lists the property names of the Literature Notes, without the Literature Note Property", async () => {
    const { notes } = await setup({
      "A.md": lit("ITEMAAAA", { literatureNote: "A", rating: 3, status: "x" }),
    });

    expect(notes.propertyNames()).toEqual(["rating", "status"]);
  });

  it("infers the type of a property from its first value", async () => {
    const { notes } = await setup({
      "A.md": lit("ITEMAAAA", {
        status: null,
        pages: 12,
        read: true,
        due: "2024-05-01",
      }),
      "B.md": lit("ITEMBBBB", { status: ["a", "b"], title: "x" }),
    });

    expect(notes.propertyType("status")).toBe("multitext");
    expect(notes.propertyType("pages")).toBe("number");
    expect(notes.propertyType("read")).toBe("checkbox");
    expect(notes.propertyType("due")).toBe("date");
    expect(notes.propertyType("title")).toBe("text");
    expect(notes.propertyType("missing")).toBe("text");
  });

  it("infers a date and time without seconds, as Obsidian does", async () => {
    const { notes } = await setup({
      "A.md": lit("ITEMAAAA", {
        at: "2024-05-01T10:30",
        stamp: "2024-05-01T10:30:00",
      }),
    });

    expect(notes.propertyType("at")).toBe("datetime");
    expect(notes.propertyType("stamp")).toBe("text");
  });

  it("infers an unassigned type from the cell's own value, and from the column's first value for no value", async () => {
    const { notes } = await setup({
      "A.md": lit("ITEMAAAA", { flag: true }),
      "B.md": lit("ITEMBBBB", { flag: "maybe" }),
    });

    expect(notes.propertyType("flag", "maybe")).toBe("text");
    expect(notes.propertyType("flag", true)).toBe("checkbox");
    expect(notes.propertyType("flag", null)).toBe("checkbox");
    expect(notes.propertyType("flag")).toBe("checkbox");
  });

  it("reads the property names again once the Note Index has indexed the notes", async () => {
    const { notes, host } = await setup(
      { "A.md": lit("ITEMAAAA", { status: "unread" }) },
      { scanned: false },
    );
    const listener = vi.fn();
    const off = notes.on("changed", listener);
    // A view's first render, before the Full Scan.
    expect(notes.propertyNames()).toEqual([]);

    startup(host);
    await vi.waitFor(() => expect(listener).toHaveBeenCalled());
    off();

    expect(listener).toHaveBeenCalledOnce();
    expect(notes.propertyNames()).toEqual(["status"]);
  });

  it("takes the type Obsidian assigns a property over the one its values show", async () => {
    const { notes } = await setup(
      {
        "A.md": lit("ITEMAAAA", {
          pages: "12",
          due: "soon",
          tags2: "x",
          stamp: "a",
        }),
      },
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
    expect(notes.propertyType("pages", "12")).toBe("number");
    expect(notes.propertyType("due")).toBe("date");
    expect(notes.propertyType("tags2")).toBe("multitext");
    expect(notes.propertyType("stamp")).toBe("datetime");
    expect(notes.propertyType("read")).toBe("checkbox");
    // A type ZotLit has no editor for falls back to the values.
    expect(notes.propertyType("cover")).toBe("text");
  });

  it("reads the notes once for the types until a frontmatter changes", async () => {
    const { notes, getCache, write } = await setup({
      "A.md": lit("ITEMAAAA", { pages: 12 }),
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

    await write("A.md", lit("ITEMAAAA", { pages: "twelve" }));
    await vi.waitFor(() => expect(seen).not.toEqual([]));
    off();

    // A listener reads the change, not the type from before it.
    expect(seen).toEqual(["text"]);
  });

  it("reads the notes again when a Literature Note is added", async () => {
    const { notes, write } = await setup({});
    const listener = vi.fn();
    const off = notes.on("changed", listener);

    expect(notes.propertyType("pages")).toBe("text");
    await write("A.md", lit("ITEMAAAA", { pages: 12 }));
    await vi.waitFor(() => expect(listener).toHaveBeenCalled());

    expect(notes.propertyType("pages")).toBe("number");
    off();
  });

  it("tells a change of an assigned type as a frontmatter change, and reads it", async () => {
    const { notes, setType } = await setup(
      { "A.md": lit("ITEMAAAA", { pages: "12" }) },
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

  it("tells a frontmatter change of a Literature Note", async () => {
    const { notes, write } = await setup({
      "A.md": lit("ITEMAAAA", { status: "unread" }),
    });
    const listener = vi.fn();
    const off = notes.on("frontmatter-changed", listener);

    await write("A.md", lit("ITEMAAAA", { status: "reading" }));
    await vi.waitFor(() => expect(listener).toHaveBeenCalled());
    off();
    await write("A.md", lit("ITEMAAAA", { status: "read" }));

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("literatureNotes vault property writes", () => {
  afterEach(() => {
    vi.mocked(chooseLiteratureNoteProfile).mockReset();
  });
  /** A vault of notes on disk, the Note Index over them, and the keys each note's Profile replaces. */
  async function vault(
    files: Record<string, string>,
    {
      replaced = {},
      selection = { selector: "default", source: "bound", shouldAsk: false },
    }: {
      /** The keys each note's Profile replaces on each update, by path. */
      replaced?: Record<string, string[]>;
      /** The Profile the usual creation resolves for an Item. */
      selection?: CreationProfileSelection;
    } = {},
  ) {
    const host = createObsidianHost(files);
    const noteIndex = buildNoteIndex(host.app as unknown as App, owned);
    await noteIndex.whenIndexed();
    const replacedKeys = vi.fn(
      async (file: TFile) => new Set(replaced[file.path] ?? []),
    );
    const sources = { profile: testEvent<void>(), template: testEvent<void>() };
    /** The usual creation: a note at `<key>.md`, as the Profile's template writes it. */
    const createNote = vi.fn(async (item: { indexedKey: string }) => ({
      outcome: "created" as const,
      file: host.vault.createFile(
        `${item.indexedKey}.md`,
        `---\nzotero-key: ${item.indexedKey}\n---\n`,
      ),
    }));
    const app = stubService<LiteratureNotesDeps["app"]>("App", {
      vault: host.vault as unknown as LiteratureNotesDeps["app"]["vault"],
      metadataTypeManager: undefined,
      metadataCache: stubService<App["metadataCache"]>("MetadataCache", {
        getFileCache: (file: TFile) => host.metadataCache.getFileCache(file),
        getCache: (path: string) =>
          host.metadataCache.getFileCache(host.file(path)),
      }),
      workspace:
        host.workspace as unknown as LiteratureNotesDeps["app"]["workspace"],
    });
    const readsService = owned.use(stubbedReads());
    const reads = new Proxy(readsService.reads, {
      get(target, property, receiver) {
        if (property === "ItemsByIndexedKeys")
          return ({ indexedKeys }: { indexedKeys: readonly string[] }) =>
            Effect.succeed(
              new Map(
                indexedKeys.map((key) => [
                  key,
                  makeItem(
                    { itemType: "journalArticle", key },
                    { key, indexedKey: key },
                  ),
                ]),
              ),
            );
        return Reflect.get(target, property, receiver);
      },
    });
    const deps = stubService<LiteratureNotesDeps>("LiteratureNotesDeps", {
      runtime: testRuntime(),
      app,
      noteIndex,
      profile: stubService<LiteratureNotesDeps["profile"]>("Profile", {
        changed: sources.profile.stream,
      }),
      template: stubService<LiteratureNotesDeps["template"]>("Template", {
        "compile-status-changed": sources.template.stream,
      }),
      zoteroReads: stubService<LiteratureNotesDeps["zoteroReads"]>(
        "ZoteroReads",
        {
          reads: stubService<LiteratureNotesDeps["zoteroReads"]["reads"]>(
            "ZoteroReadsApi",
            reads,
          ),
        },
      ),
      zoteroPref: stubService<LiteratureNotesDeps["zoteroPref"]>("ZoteroPref", {
        dataDir: "/Zotero",
      }),
      noteFeature: stubService<LiteratureNotesDeps["noteFeature"]>(
        "NoteFeature",
        {
          createNote,
          planCreations: async (keys: readonly string[]) =>
            creationPlans(keys, selection, createNote),
          replacedKeys,
        },
      ),
    });
    return {
      host,
      replaced,
      replacedKeys,
      /** Fire a change of the Profiles, or of the templates. */
      changed: (of: "profile" | "template") => {
        sources[of].emit();
      },
      notes: literatureNotes(deps),
      createNote,
    };
  }

  it("writes only the edited key of the Item's Literature Note", async () => {
    const { host, notes } = await vault({
      "A.md":
        "---\nzotero-key: ITEMAAAA\ntitle: Rules\nstatus: unread\nrating: 3\n---\nBody\n",
    });

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
    const { host, notes } = await vault({
      "A.md": "---\nzotero-key: ITEMAAAA\nstatus: unread\n---\nSaved\n",
    });
    const editor = openTextFileView(host, host.file("A.md"));
    editor.edit("---\nzotero-key: ITEMAAAA\nstatus: unread\n---\nTyped\n");

    await notes.write({
      itemKey: "ITEMAAAA",
      name: "status",
      value: "read",
      host: null,
    });

    expect(editor.getViewData()).toBe(
      "---\nzotero-key: ITEMAAAA\nstatus: read\n---\nTyped\n",
    );
  });

  it("keeps a cleared key, with no value", async () => {
    const { host, notes } = await vault({
      "A.md": "---\nzotero-key: ITEMAAAA\nstatus: unread\nrating: 3\n---\n",
    });

    await notes.write({
      itemKey: "ITEMAAAA",
      name: "status",
      value: null,
      host: null,
    });

    expect(
      host.metadataCache.getFileCache(host.file("A.md"))?.frontmatter,
    ).toEqual({ "zotero-key": "ITEMAAAA", status: null, rating: 3 });
  });

  it("writes the note that holds the view for its own Item", async () => {
    const { host, notes } = await vault({
      // Written first, so the index ranks the newer A.md above it.
      "A (copy).md": "---\nzotero-key: ITEMAAAA\nstatus: unread\n---\n",
      "A.md": "---\nzotero-key: ITEMAAAA\nstatus: unread\n---\n",
    });

    await notes.write({
      itemKey: "ITEMAAAA",
      name: "status",
      value: "read",
      host: {
        path: "A (copy).md",
        itemKey: "ITEMAAAA",
      },
    });

    expect(host.text("A (copy).md")).toBe(
      "---\nzotero-key: ITEMAAAA\nstatus: read\n---\n",
    );
    expect(host.text("A.md")).toBe(
      "---\nzotero-key: ITEMAAAA\nstatus: unread\n---\n",
    );
  });

  it("creates the Literature Note of an Item with none, then writes the key to it", async () => {
    const { host, notes, createNote } = await vault({});

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
  });

  it("creates the note but writes no key its Profile replaces", async () => {
    const { host, notes } = await vault(
      {},
      { replaced: { "ITEMAAAA.md": ["status"] } },
    );

    await expect(
      notes.write({
        itemKey: "ITEMAAAA",
        name: "status",
        value: "read",
        host: null,
      }),
    ).resolves.toBe("managed");

    expect(host.text("ITEMAAAA.md")).toBe("---\nzotero-key: ITEMAAAA\n---\n");
  });

  it("writes no key the note's Profile replaces", async () => {
    const { host, notes } = await vault(
      { "A.md": "---\nzotero-key: ITEMAAAA\nstatus: unread\n---\n" },
      { replaced: { "A.md": ["status"] } },
    );

    await expect(
      notes.write({
        itemKey: "ITEMAAAA",
        name: "status",
        value: "read",
        host: null,
      }),
    ).resolves.toBe("managed");

    expect(host.text("A.md")).toBe(
      "---\nzotero-key: ITEMAAAA\nstatus: unread\n---\n",
    );
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
      });
      const { host, notes } = await vault({}, { selection: ask });

      await expect(notes.write(edit)).resolves.toBe("created");

      expect(chooseLiteratureNoteProfile).toHaveBeenCalledOnce();
      expect(host.text("ITEMAAAA.md")).toBe(
        "---\nzotero-key: ITEMAAAA\nstatus: read\n---\n",
      );
    });

    it("creates and writes nothing when the prompt is cancelled", async () => {
      vi.mocked(chooseLiteratureNoteProfile).mockResolvedValueOnce(undefined);
      const { host, notes, createNote } = await vault({}, { selection: ask });

      await expect(notes.write(edit)).resolves.toBe("cancelled");

      expect(createNote).not.toHaveBeenCalled();
      expect(host.vault.getMarkdownFiles()).toEqual([]);
    });
  });

  it("tells a key the note's own Profile replaces, once its Profile is read, and says so", async () => {
    const { notes } = await vault(
      {
        "A.md": "---\nzotero-key: ITEMAAAA\n---\n",
        "B.md": "---\nzotero-key: ITEMBBBB\n---\n",
      },
      { replaced: { "A.md": ["status"] } },
    );
    const listener = vi.fn();
    const off = notes.on("frontmatter-changed", listener);

    // A cell reads before the Profile is read, and reads again when told.
    expect(notes.managed("ITEMAAAA", "status", null)).toBe(false);
    await vi.waitFor(() => expect(listener).toHaveBeenCalled());
    off();

    expect(notes.managed("ITEMAAAA", "status", null)).toBe(true);
    expect(notes.managed("ITEMAAAA", "rating", null)).toBe(false);
    // The same key on a note of another Profile.
    notes.managed("ITEMBBBB", "status", null);
    await vi.waitFor(() =>
      expect(notes.managed("ITEMBBBB", "status", null)).toBe(false),
    );
    // No note: nothing manages the key.
    expect(notes.managed("ITEMDDDD", "status", null)).toBe(false);
  });

  it("reads a note's Profile once, and again when that note's frontmatter changes", async () => {
    const { host, notes, replaced, replacedKeys } = await vault(
      {
        "A.md": "---\nzotero-key: ITEMAAAA\n---\n",
        "B.md": "---\nzotero-key: ITEMBBBB\n---\n",
      },
      { replaced: { "A.md": ["status"] } },
    );
    const read = async (itemKey: string) => {
      notes.managed(itemKey, "status", null);
      await vi.waitFor(() =>
        expect(replacedKeys.mock.results.at(-1)?.value).toBeDefined(),
      );
      await replacedKeys.mock.results.at(-1)!.value;
    };
    await read("ITEMAAAA");
    await read("ITEMBBBB");
    expect(notes.managed("ITEMAAAA", "status", null)).toBe(true);
    expect(notes.managed("ITEMAAAA", "rating", null)).toBe(false);
    expect(replacedKeys).toHaveBeenCalledTimes(2);

    // The note's stamp names another Profile now.
    replaced["A.md"] = [];
    const told = vi.fn();
    const off = notes.on("frontmatter-changed", told);
    await host.vault.modify(
      host.file("A.md"),
      "---\nzotero-key: ITEMAAAA\nzotlit-profile: other\n---\n",
    );
    await vi.waitFor(() => expect(told).toHaveBeenCalled());
    off();
    await read("ITEMAAAA");

    expect(notes.managed("ITEMAAAA", "status", null)).toBe(false);
    // Only that note is read again.
    notes.managed("ITEMBBBB", "status", null);
    expect(replacedKeys).toHaveBeenCalledTimes(3);
  });

  it.each(["profile", "template"] as const)(
    "reads every note's Profile again when a %s changes, and says so",
    async (of) => {
      const { notes, replaced, changed } = await vault(
        { "A.md": "---\nzotero-key: ITEMAAAA\n---\n" },
        { replaced: { "A.md": [] } },
      );
      notes.managed("ITEMAAAA", "status", null);
      await vi.waitFor(() => {});
      const listener = vi.fn();
      const off = notes.on("frontmatter-changed", listener);

      // The field is set to the replace strategy.
      replaced["A.md"] = ["status"];
      changed(of);
      expect(listener).toHaveBeenCalled();
      notes.managed("ITEMAAAA", "status", null);
      await vi.waitFor(() =>
        expect(notes.managed("ITEMAAAA", "status", null)).toBe(true),
      );
      off();
    },
  );

  it("reads the host note's own Profile for its Item", async () => {
    const { notes } = await vault(
      {
        // Written first, so the index ranks the newer A.md above it.
        "A (copy).md": "---\nzotero-key: ITEMAAAA\n---\n",
        "A.md": "---\nzotero-key: ITEMAAAA\n---\n",
      },
      { replaced: { "A (copy).md": ["status"] } },
    );
    const host = { path: "A (copy).md", itemKey: "ITEMAAAA" };

    notes.managed("ITEMAAAA", "status", host);
    await vi.waitFor(() =>
      expect(notes.managed("ITEMAAAA", "status", host)).toBe(true),
    );
  });
});
