// The Query File document owns a Query View's text, the view on screen, every
// edit and the save timing. These tests drive it as the Query View does: text
// and edits in, the file, the view on screen and the saved text out.
import { afterEach, describe, expect, it, vi } from "vitest";

import { QueryFileDocument, SAVE_DELAY_MS } from "./query-file-document";
import type { DocumentHost } from "./query-file-document";

const FILE = `views:
  - type: annotations
    name: Yellow
    from: annotations
  - type: annotations
    name: Everything
    from: annotations
  - type: annotations
    name: Blue
    from: annotations
`;

/** Three views without a name, each told apart by its limit. */
const UNNAMED = `views:
  - type: annotations
    from: annotations
    limit: 1
  - type: annotations
    from: annotations
    limit: 2
  - type: annotations
    from: annotations
    limit: 3
`;

function open(
  text: string | null,
  host: Partial<DocumentHost> = {},
  wanted: string | null = null,
) {
  const saved: string[] = [];
  const selected: string[] = [];
  const failed: boolean[] = [];
  let shows = 0;
  const document = new QueryFileDocument(
    {
      save: (next) => {
        saved.push(next);
        return host.save?.(next);
      },
      onSelectView: (name) => selected.push(name),
      ...(host.canSave && { canSave: host.canSave }),
    },
    {
      show: () => shows++,
      saveFailed: (value) => failed.push(value),
    },
  );
  document.selectView(wanted);
  if (text !== null) document.setText(text);
  return {
    document,
    saved,
    selected,
    failed,
    /** How many times the document said the file or the view on screen changed. */
    shows: () => shows,
    /** The name of the view on screen. */
    shown: () => document.view?.name ?? null,
    names: () => document.file?.views.map((view) => view.name) ?? [],
    /** The limits of the views, which tell unnamed views apart. */
    limits: () => document.file?.views.map((view) => view.limit) ?? [],
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the view on screen", () => {
  it("shows the first view, or the view the host asks for", () => {
    expect(open(FILE).shown()).toBe("Yellow");
    expect(open(FILE, {}, "Blue").shown()).toBe("Blue");
  });

  it("shows a new view and a copy at once, and tells the host", () => {
    const { document, shown, names, selected } = open(FILE);
    expect(document.addView("View")).toBe("View");
    expect(shown()).toBe("View");
    document.duplicateView(1);
    expect(names()).toEqual([
      "Yellow",
      "Everything",
      "Everything 2",
      "Blue",
      "View",
    ]);
    expect(shown()).toBe("Everything 2");
    expect(selected).toEqual(["View", "Everything 2"]);
  });

  it("shows the view before a deleted view on screen, and keeps another view on screen", () => {
    const { document, shown } = open(FILE, {}, "Everything");
    document.deleteView(1);
    expect(shown()).toBe("Yellow");

    const other = open(FILE, {}, "Blue");
    other.document.deleteView(0);
    expect(other.shown()).toBe("Blue");
    other.document.selectView("Everything");
    other.document.deleteView(0);
    // The first view's neighbour is the view after it.
    expect(other.shown()).toBe("Blue");
    // The last view stays.
    other.document.deleteView(0);
    expect(other.names()).toEqual(["Blue"]);
  });

  it("follows a moved view, and keeps the view on screen when another view moves", () => {
    const { document, shown, names } = open(FILE, {}, "Blue");
    document.moveView(2, 0);
    expect(names()).toEqual(["Blue", "Yellow", "Everything"]);
    expect(shown()).toBe("Blue");
    document.moveView(1, 2);
    expect(names()).toEqual(["Blue", "Everything", "Yellow"]);
    expect(shown()).toBe("Blue");
  });

  it("keeps the first view on screen when another view moves to the top", () => {
    const { document, shown } = open(FILE);
    document.moveView(2, 0);
    expect(shown()).toBe("Yellow");
  });

  it("keeps a renamed view on screen, and tells the host its new name", () => {
    const { document, shown, selected } = open(FILE, {}, "Everything");
    document.renameView(1, "All");
    expect(shown()).toBe("All");
    expect(document.viewName).toBe("All");
    expect(selected).toEqual(["All"]);
    document.renameView(0, "Gold");
    expect(shown()).toBe("All");
  });

  it.each([
    [
      "a view edit",
      (document: QueryFileDocument) => document.editView({ limit: 5 }),
    ],
    [
      "a view option",
      (document: QueryFileDocument) =>
        document.setViewOption(1, "showPage", false),
    ],
    [
      "a layout",
      (document: QueryFileDocument) => document.setViewLayout(1, "list"),
    ],
    [
      "a dataset",
      (document: QueryFileDocument) => document.setViewDataset(1, "items"),
    ],
    [
      "filters",
      (document: QueryFileDocument) =>
        document.setFilters("view", 'colorName == "red"'),
    ],
    [
      "filters for all views",
      (document: QueryFileDocument) =>
        document.setFilters("all", 'colorName == "red"'),
    ],
    [
      "a Formula",
      (document: QueryFileDocument) =>
        document.saveFormula("year", "date.year", "Year"),
    ],
    [
      "a Display Name",
      (document: QueryFileDocument) =>
        document.renameProperty("comment", "Note"),
    ],
    [
      "a removed Formula",
      (document: QueryFileDocument) => document.removeFormula("year"),
    ],
  ])("keeps the view on screen after %s", (_, edit) => {
    const { document, shown, selected } = open(
      `formulas:\n  year: date.year\n${FILE}`,
      {},
      "Everything",
    );
    const before = document.file;
    edit(document);
    expect(document.file).not.toBe(before);
    expect(shown()).toBe("Everything");
    expect(selected).toEqual([]);
  });
});

describe("the view on screen of a file whose views have no name", () => {
  it("follows a moved view and keeps it on screen through later edits", () => {
    const { document, limits } = open(UNNAMED);
    document.moveView(0, 2);
    expect(limits()).toEqual([2, 3, 1]);
    expect(document.view?.limit).toBe(1);
    document.editView({ limit: 9 });
    expect(limits()).toEqual([2, 3, 9]);
    expect(document.view?.limit).toBe(9);
  });

  it("shows a copy, keeps it on screen through an edit, and shows its neighbour once deleted", () => {
    const { document, limits } = open(UNNAMED);
    document.duplicateView(1);
    expect(limits()).toEqual([1, 2, 2, 3]);
    document.setViewOption(2, "showPage", false);
    document.editView({ limit: 7 });
    expect(limits()).toEqual([1, 2, 7, 3]);
    expect(document.view?.limit).toBe(7);
    document.deleteView(0);
    expect(document.view?.limit).toBe(7);
    document.deleteView(1);
    expect(limits()).toEqual([2, 3]);
    expect(document.view?.limit).toBe(2);
  });
});

describe("two Query Views of one file", () => {
  it("each keep their own view on screen as the other's edits arrive", async () => {
    const tab = open(FILE, {}, "Everything");
    const embed = open(FILE, {}, "Blue");
    tab.document.deleteView(0);
    tab.document.moveView(1, 0);
    tab.document.editView({ limit: 5 });
    await tab.document.flush();
    for (const text of tab.saved) embed.document.setText(text);
    expect(tab.shown()).toBe("Everything");
    expect(embed.names()).toEqual(["Blue", "Everything"]);
    expect(embed.shown()).toBe("Blue");
    expect(embed.selected).toEqual([]);
  });

  it("keeps the view an embed names after its own edits and after a peer's", async () => {
    const embed = open(FILE, {}, "Blue");
    embed.document.moveView(2, 0);
    embed.document.setFilters("view", 'colorName == "blue"');
    expect(embed.document.wanted).toBe("Blue");
    await embed.document.flush();
    const tab = open(embed.saved.at(-1)!, {}, "Yellow");
    tab.document.addView("View");
    tab.document.moveView(3, 0);
    await tab.document.flush();
    embed.document.setText(tab.saved.at(-1)!);
    expect(embed.shown()).toBe("Blue");
    expect(embed.document.view?.filters).toBe('colorName == "blue"');
  });
});

describe("saving an edit", () => {
  it("saves typed text once, after the delay from the last key, and a menu choice at once", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { document, saved } = open(FILE);
    document.editView({ limit: 5 }, { typed: true });
    vi.advanceTimersByTime(300);
    document.editView({ limit: 50 }, { typed: true });
    vi.advanceTimersByTime(SAVE_DELAY_MS - 1);
    expect(saved).toEqual([]);
    expect(document.view?.limit).toBe(50);
    vi.advanceTimersByTime(1);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toContain("    limit: 50\n");
    await document.flush();

    // A menu choice saves at once, with the typed text that still waits.
    document.editView({ limit: 7 }, { typed: true });
    document.editView({ order: ["comment"] });
    expect(saved).toHaveLength(2);
    expect(saved[1]).toContain("    limit: 7\n");
    expect(saved[1]).toContain("      - comment\n");
    vi.advanceTimersByTime(SAVE_DELAY_MS);
    expect(saved).toHaveLength(2);
  });

  it("saves a typed view name after the delay, and at once on flush", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { document, saved } = open(FILE);
    document.renameView(0, "Yellow highlights");
    expect(saved).toEqual([]);
    await document.flush();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toContain("name: Yellow highlights");
    vi.advanceTimersByTime(SAVE_DELAY_MS);
    expect(saved).toHaveLength(1);
  });

  it("changes nothing when the host gives the text of its own save back", () => {
    const { document, saved, shows } = open(FILE);
    document.editView({ limit: 6 });
    const { file } = document;
    const count = shows();
    expect(document.setText(saved.at(-1)!)).toBe(false);
    expect(document.file).toBe(file);
    expect(shows()).toBe(count);
  });

  it("keeps a change on screen and says it is not saved when the host cannot write it, until a later save works", async () => {
    let fail = true;
    const { document, failed } = open(FILE, {
      save: () =>
        fail ? Promise.reject(new Error("disk full")) : Promise.resolve(),
    });
    document.editView({ limit: 5 });
    await document.flush();
    expect(document.view?.limit).toBe(5);
    expect(failed).toEqual([true]);

    fail = false;
    document.editView({ limit: 6 });
    await document.flush();
    expect(failed).toEqual([true, false]);
  });

  it.each([
    [
      "adds a Formula",
      (document: QueryFileDocument) =>
        document.saveFormula("month", "date.month"),
    ],
    [
      "names a property",
      (document: QueryFileDocument) =>
        document.renameProperty("title", "Paper"),
    ],
    [
      "removes a Formula",
      (document: QueryFileDocument) => document.removeFormula("year"),
    ],
  ])(
    "keeps a Formula edit on screen and says it is not saved when the host cannot write it: %s",
    async (_, edit) => {
      const { document, failed } = open(
        `formulas:\n  year: date.year\n${FILE}`,
        {
          save: () => Promise.reject(new Error("disk full")),
        },
      );
      const before = document.file;
      expect(edit(document)).toBe(true);
      await document.flush();
      expect(document.file).not.toBe(before);
      expect(failed).toEqual([true]);
    },
  );

  it("writes one save at a time, in the order of the edits, and shows the result of the last", async () => {
    const writes: { text: string; settle: (ok: boolean) => void }[] = [];
    const { document, failed } = open(FILE, {
      save: (text) =>
        new Promise<void>((resolve, reject) =>
          writes.push({
            text,
            settle: (ok) => (ok ? resolve() : reject(new Error("disk full"))),
          }),
        ),
    });
    const limits = () =>
      writes.map(({ text }) => text.match(/limit: (\d+)/)?.[1]);
    document.editView({ limit: 5 });
    document.editView({ limit: 6 });
    // The second save waits until the host wrote the first.
    expect(limits()).toEqual(["5"]);
    const flushed = document.flush();
    writes[0]!.settle(false);
    await vi.waitFor(() => expect(limits()).toEqual(["5", "6"]));
    writes[1]!.settle(true);
    await flushed;
    expect(failed).toEqual([false]);
  });

  it("shows a change but saves nothing where the host cannot save", async () => {
    const { document, saved } = open(FILE, { canSave: () => false });
    expect(document.canSave).toBe(false);
    document.editView({ limit: 5 });
    await document.flush();
    expect(document.view?.limit).toBe(5);
    expect(saved).toEqual([]);
  });
});
