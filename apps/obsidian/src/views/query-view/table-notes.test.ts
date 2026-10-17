// The vault properties of the Query View as the vault answers them: the
// frontmatter of an Item's Literature Note, by the Note Index, or of the note
// that holds the view.
import { describe, expect, it, vi } from "vitest";

import { NoteIndexStub } from "@/services/note-index/test-stub";

import { literatureNotes } from "./table-notes";
import type { LiteratureNotesDeps } from "./table-notes";

vi.mock("@/views/annot-view/register", () => ({
  activateAnnotView: vi.fn(),
}));

/** A vault of notes by path, each with its frontmatter. */
function setup(
  frontmatter: Record<string, Record<string, unknown>>,
  index: Record<string, { path: string }[]>,
  names: readonly string[] = [],
) {
  const noteIndex = new NoteIndexStub(index, names);
  const deps = {
    app: {
      metadataCache: {
        getCache: (path: string) =>
          path in frontmatter ? { frontmatter: frontmatter[path] } : null,
      },
    },
    noteIndex,
  } as unknown as LiteratureNotesDeps;
  return { notes: literatureNotes(deps), noteIndex };
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
    const { notes } = setup({}, {}, ["literatureNote", "rating", "status"]);

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
