import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as Atom from "effect/reactivity/Atom";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { DataExplorer } from "./data-explorer";
import type {
  FieldInsertionContext,
  FieldInsertOptions,
} from "./field-insertion";
import { fieldsActionAttributes } from "./fields-panel";
import { useWorkbenchHost } from "./host";
import { pressFieldsAction } from "./model";
import { INITIAL_PANELS } from "./panel-layout";
import type { ViewSize, WorkbenchPanels } from "./panel-layout";
import { SidePanels } from "./panels";
import { mount } from "./test-host";

import { initialTreeState } from "#/explorer/index";
import { withText } from "#/explorer/test-records";

afterEach(cleanup);

const PAPER = {
  title: "Linked notes in practice",
  DOI: "10.1000/linked-notes",
  abstract: "",
  shelf: { label: "Methods" },
};

/** What an insert of the paper's title writes into a Liquid template. */
const TITLE = "{{ zt.title }}";

const PREVIEW: WorkbenchPanels = {
  ...INITIAL_PANELS,
  preview: { ...INITIAL_PANELS.preview, shown: true },
};
const PINNED: WorkbenchPanels = {
  ...PREVIEW,
  fields: { ...INITIAL_PANELS.fields, pinned: true },
};

/** The explorer the hosts put in the Fields Panel, over its own navigation. */
function Fields({
  onInsert,
  insertion,
  disabled = false,
  data = PAPER,
}: {
  disabled?: boolean;
  data?: Record<string, unknown>;
  insertion?: FieldInsertionContext;
  onInsert: (text: string, options: FieldInsertOptions) => boolean | void;
}) {
  const [collapsedSections, setCollapsedSections] = useState<
    ReadonlySet<string>
  >(() => new Set<string>());
  const [navigation, setNavigation] = useState(initialTreeState);
  const host = useWorkbenchHost();
  return (
    <DataExplorer
      root="note"
      data={data}
      copy={(text) => host.copy!(text)}
      collapsedSections={collapsedSections}
      onCollapsedSectionsChange={setCollapsedSections}
      navigation={navigation}
      onNavigationChange={setNavigation}
      onInsert={onInsert}
      {...(insertion && { insertion: () => insertion })}
      disabled={disabled}
    />
  );
}

function open({
  size = { width: 560, height: 800 },
  refuse = false,
  disabled = false,
  panels = PREVIEW,
  data,
  insertion,
}: {
  size?: ViewSize;
  refuse?: boolean;
  disabled?: boolean;
  panels?: WorkbenchPanels;
  data?: Record<string, unknown>;
  insertion?: FieldInsertionContext;
} = {}) {
  const viewSize = Atom.make<ViewSize | null>(size);
  const keptOpen: boolean[] = [];
  /** What each insert put into the note. */
  const texts: string[] = [];
  const mounted = mount(
    <SidePanels
      panels={{
        fields: {
          label: "Fields",
          resizeLabel: "Resize fields",
          content: (
            <Fields
              disabled={disabled}
              data={data}
              insertion={insertion}
              onInsert={(text, { keepOpen }) => {
                if (refuse) return false;
                keptOpen.push(keepOpen);
                texts.push(text);
                return true;
              }}
            />
          ),
        },
        preview: {
          label: "Preview",
          resizeLabel: "Resize preview",
          content: <button type="button">Show problem</button>,
        },
      }}
    >
      <textarea aria-label="Template source" />
    </SidePanels>,
    { panels, viewSize },
  );
  render(mounted.ui);
  return Object.assign(mounted, {
    keptOpen,
    texts,
    resize: (next: ViewSize) => act(() => mounted.registry.set(viewSize, next)),
    pressAction: () =>
      act(() => pressFieldsAction(mounted.registry, mounted.model)),
    isOpen: () => mounted.registry.get(mounted.model.fieldsAction).open,
  });
}

/** The Fields Panel on the host's popover. */
const panel = () => screen.queryByRole("dialog", { name: "Fields" });
/** The Fields Panel docked beside the editor. */
const docked = () => screen.queryByRole("region", { name: "Fields" });
/** The pin in the header of the panel that stands. */
const pin = () =>
  within((panel() ?? docked())!).getByRole("button", {
    name: /pin/i,
  });
/** Whether focus went back to the Fields action as the popover last closed. */
const returnedFocus = () =>
  document
    .querySelector("[data-return-focus]")
    ?.getAttribute("data-return-focus");
const titleRow = () =>
  within((panel() ?? docked())!)
    .getAllByRole("treeitem")
    .find((row) => row.textContent?.includes("Title"))!;
const insertTitle = (init?: MouseEventInit) =>
  fireEvent.click(
    within(titleRow()).getByRole("button", { name: "Insert field" }),
    init,
  );

describe("the Fields Panel popover", () => {
  it.each([320, 560, 760, 960, 1200])(
    "opens from the Fields action over a %i px view, and a second press closes it",
    (width) => {
      using page = open({ size: { width, height: 800 } });
      expect(panel()).toBeNull();
      page.pressAction();
      expect(panel()!.id).toBe("fake-fields-panel");
      expect(page.registry.get(page.model.placement).fields).toBe("popover");
      page.pressAction();
      expect(panel()).toBeNull();
      expect(page.registry.get(page.model.placement).fields).toBe("closed");
    },
  );

  it("puts focus in its search field, and leaves the editor and the Preview in reach", () => {
    using page = open();
    page.pressAction();
    expect(document.activeElement).toBe(within(panel()!).getByRole("combobox"));
    // A popover, not a modal: nothing under it turns inert.
    expect(panel()!.hasAttribute("aria-modal")).toBe(false);
    expect(document.querySelector("[inert]")).toBeNull();
    const problem = screen.getByRole("button", { name: "Show problem" });
    act(() => problem.focus());
    expect(document.activeElement).toBe(problem);
  });

  it("closes on its Close button, with focus back to the Fields action", () => {
    using page = open();
    page.pressAction();
    fireEvent.click(within(panel()!).getByRole("button", { name: "Close" }));
    expect(panel()).toBeNull();
    expect(returnedFocus()).toBe("true");
  });

  it("closes once it inserts a field, and leaves focus to the editor", () => {
    using page = open();
    page.pressAction();
    insertTitle();
    expect(page.texts).toEqual([TITLE]);
    expect(page.keptOpen).toEqual([false]);
    expect(panel()).toBeNull();
    expect(returnedFocus()).toBe("false");
    // The next opening hands focus back again when it closes.
    page.pressAction();
    page.pressAction();
    expect(returnedFocus()).toBe("true");
  });

  it("stays open for the next field on a Shift-click of Insert", () => {
    using page = open();
    page.pressAction();
    insertTitle({ shiftKey: true });
    expect(page.texts).toEqual([TITLE]);
    // The host keeps focus off the editor for the next field.
    expect(page.keptOpen).toEqual([true]);
    expect(panel()).not.toBeNull();
    // Shift+Enter on the button keeps it open as well.
    fireEvent.keyDown(
      within(titleRow()).getByRole("button", { name: "Insert field" }),
      { key: "Enter", shiftKey: true },
    );
    expect(page.texts).toEqual([TITLE, TITLE]);
    expect(panel()).not.toBeNull();
  });

  it("stays open when the editor refuses the field", () => {
    using page = open({ refuse: true });
    page.pressAction();
    insertTitle();
    expect(panel()).not.toBeNull();
  });

  it("never opens or closes as the view changes size", () => {
    using page = open({ size: { width: 1200, height: 800 } });
    page.resize({ width: 320, height: 400 });
    expect(page.isOpen()).toBe(false);
    page.pressAction();
    page.resize({ width: 1200, height: 900 });
    expect(page.isOpen()).toBe(true);
    expect(panel()).not.toBeNull();
  });
});

describe("the pinned Fields Panel", () => {
  it("docks beside the editor once the reader pins it in a wide view", () => {
    using page = open({ size: { width: 1200, height: 800 } });
    page.pressAction();
    expect(pin().getAttribute("aria-label")).toBe("Pin to side");
    expect(pin().getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(pin());
    expect(panel()).toBeNull();
    expect(docked()).not.toBeNull();
    expect(page.registry.get(page.model.placement).fields).toBe("docked");
    // The region takes its name from the title it shows, so a host that
    // draws aria-label as a tooltip shows none over the column.
    expect(docked()!.hasAttribute("aria-label")).toBe(false);
    expect(page.registry.get(page.model.panels).fields.pinned).toBe(true);
    expect(pin().getAttribute("aria-label")).toBe("Unpin");
    expect(pin().getAttribute("aria-pressed")).toBe("true");
    // The docked panel takes over focus, in its search field.
    expect(document.activeElement).toBe(
      within(docked()!).getByRole("combobox"),
    );
    // Its edge sizes it; it has no Close button and is not modal.
    expect(
      screen.getByRole("separator", { name: "Resize fields" }),
    ).not.toBeNull();
    expect(
      within(docked()!).queryByRole("button", { name: "Close" }),
    ).toBeNull();
    expect(document.querySelector("[inert]")).toBeNull();
    expect(page.isOpen()).toBe(true);
  });

  it("stays docked as it inserts, and leaves focus to the editor", () => {
    using page = open({ size: { width: 1200, height: 800 }, panels: PINNED });
    insertTitle();
    expect(page.texts).toEqual([TITLE]);
    expect(page.keptOpen).toEqual([false]);
    expect(docked()).not.toBeNull();
  });

  it("hides and shows from the Fields action, and keeps its pin", () => {
    using page = open({ size: { width: 1200, height: 800 }, panels: PINNED });
    expect(docked()).not.toBeNull();
    // A docked panel restored with the view takes no focus.
    expect(document.activeElement).toBe(document.body);
    page.pressAction();
    expect(docked()).toBeNull();
    expect(panel()).toBeNull();
    expect(page.isOpen()).toBe(false);
    expect(page.registry.get(page.model.panels).fields).toMatchObject({
      pinned: true,
      hidden: true,
    });
    page.pressAction();
    expect(docked()).not.toBeNull();
    expect(page.registry.get(page.model.panels).fields.hidden).toBe(false);
    expect(document.activeElement).toBe(
      within(docked()!).getByRole("combobox"),
    );
  });

  it("hands focus to the Fields action when a narrower view takes the docked panel that held it", () => {
    using page = open({ size: { width: 1200, height: 800 }, panels: PINNED });
    const search = within(docked()!).getByRole("combobox");
    act(() => search.focus());
    page.resize({ width: 560, height: 800 });
    expect(docked()).toBeNull();
    expect(page.host.calls.actionFocuses).toBe(1);
    // A panel that held no focus leaves focus where it is.
    page.resize({ width: 1200, height: 800 });
    act(() => screen.getByRole("textbox", { name: "Template source" }).focus());
    page.resize({ width: 560, height: 800 });
    expect(page.host.calls.actionFocuses).toBe(1);
  });

  it("opens in the Fields popover once the reader unpins it", () => {
    using page = open({ size: { width: 1200, height: 800 }, panels: PINNED });
    fireEvent.click(pin());
    expect(docked()).toBeNull();
    expect(panel()).not.toBeNull();
    expect(page.registry.get(page.model.panels).fields.pinned).toBe(false);
  });

  it("cannot be pinned in a narrow view, and opens in the Fields popover there", () => {
    using page = open({ size: { width: 560, height: 800 } });
    page.pressAction();
    expect(pin().getAttribute("aria-label")).toBe("Widen the view to pin");
    expect(pin().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(pin());
    expect(page.registry.get(page.model.panels).fields.pinned).toBe(false);
    expect(panel()).not.toBeNull();
    expect(
      screen.queryByText("Pinned · opens over the editor in narrow views"),
    ).toBeNull();
  });

  it("notes its pin in a narrow view, and docks again as the view widens", () => {
    using page = open({ size: { width: 560, height: 800 }, panels: PINNED });
    expect(docked()).toBeNull();
    page.pressAction();
    expect(panel()).not.toBeNull();
    expect(pin().getAttribute("aria-label")).toBe("Widen the view to pin");
    expect(
      within(panel()!).getByText(
        "Pinned · opens over the editor in narrow views",
      ),
    ).not.toBeNull();
    page.resize({ width: 1200, height: 800 });
    expect(panel()).toBeNull();
    expect(docked()).not.toBeNull();
    // A view that turns narrow again opens no popover by itself.
    page.resize({ width: 560, height: 800 });
    expect(docked()).toBeNull();
    expect(panel()).toBeNull();
    expect(page.isOpen()).toBe(false);
  });
});

describe("the Fields action's state", () => {
  it("reads as a disclosure of the panel it opens", () => {
    expect(
      fieldsActionAttributes({ open: false, placement: "closed" }, "fields"),
    ).toEqual({
      "aria-haspopup": "dialog",
      "aria-expanded": "false",
      "aria-controls": undefined,
    });
    expect(
      fieldsActionAttributes({ open: true, placement: "popover" }, "fields"),
    ).toEqual({
      "aria-haspopup": "dialog",
      "aria-expanded": "true",
      "aria-controls": "fields",
    });
    // The docked panel is a region beside the editor, not a popup.
    expect(
      fieldsActionAttributes({ open: true, placement: "docked" }, "fields"),
    ).toEqual({
      "aria-haspopup": undefined,
      "aria-expanded": "true",
      "aria-controls": "fields-docked",
    });
  });
});

/** A view wide enough for the details beside the panel, and one too narrow. */
const PRESENTATIONS = [
  { presentation: "popover", size: { width: 760, height: 800 } },
  { presentation: "bar", size: { width: 420, height: 800 } },
] as const;

const doiRow = () =>
  within(panel()!)
    .getAllByRole("treeitem")
    .find((row) => row.textContent?.includes("DOI"))!;
const search = () => within(panel()!).getByRole("combobox");
/** The details of the field `label`, wherever the view shows them. */
const details = (label = "Title") =>
  within(panel()!).queryByRole("region", { name: label });
/** Where the details stand: the host's popover, or the panel's bar. */
const shownAs = (region: HTMLElement) =>
  region.closest("[data-fake-details]")
    ? "popover"
    : region.closest("[data-part=details-bar]")
      ? "bar"
      : "elsewhere";
const rowOf = (label: string) =>
  within(panel()!)
    .getAllByRole("treeitem")
    .find((row) => row.textContent?.includes(label))!;
const clickRow = (label: string) =>
  fireEvent.click(rowOf(label).querySelector("[data-part=row]")!);

describe.each(PRESENTATIONS)(
  "a field's details as a $presentation",
  ({ presentation, size }) => {
    it("open on a click on the row, never on hover, and a second click hides them", () => {
      using page = open({ size });
      page.pressAction();
      const row = rowOf("Title").querySelector("[data-part=row]")!;
      fireEvent.pointerEnter(row);
      fireEvent.mouseOver(row);
      expect(details()).toBeNull();
      // A press on the row leaves focus to the search, where ↑/↓ work.
      act(() => (document.activeElement as HTMLElement).blur());
      clickRow("Title");
      expect(document.activeElement).toBe(search());
      expect(shownAs(details()!)).toBe(presentation);
      expect(row.hasAttribute("data-open")).toBe(true);
      clickRow("Title");
      expect(details()).toBeNull();
      expect(row.hasAttribute("data-open")).toBe(false);
    });

    it("show the full value, the template path, and what the note gets", () => {
      using page = open({ size });
      page.pressAction();
      clickRow("Title");
      const region = within(details()!);
      // The value, and what the note gets from it.
      expect(region.getAllByText("Linked notes in practice")).toHaveLength(2);
      expect(region.getByText("Template path")).toBeTruthy();
      expect(region.getByText("zt.title")).toBeTruthy();
      expect(region.getByText("In your note")).toBeTruthy();
      expect(region.getByText("{{ zt.title }}")).toBeTruthy();
      expect(region.getByRole("button", { name: "Insert" })).toBeTruthy();
      expect(region.getByRole("button", { name: "Copy" })).toBeTruthy();
    });

    it("mark a field this item has no value for", () => {
      using page = open({ size });
      page.pressAction();
      clickRow("Abstract");
      expect(
        within(details("Abstract")!).getAllByText("Empty for this item"),
      ).not.toHaveLength(0);
    });

    it("toggle with Enter on the row ↑/↓ selected, and Mod+Enter inserts it", () => {
      using page = open({ size });
      page.pressAction();
      fireEvent.keyDown(search(), { key: "ArrowDown" });
      const selected = search().getAttribute("aria-activedescendant")!;
      const first = document.getElementById(selected)!;
      expect(first.getAttribute("aria-selected")).toBe("true");
      fireEvent.keyDown(search(), { key: "ArrowDown" });
      fireEvent.keyDown(search(), { key: "ArrowUp" });
      expect(search().getAttribute("aria-activedescendant")).toBe(selected);
      // The first row is the common section's Title.
      const label = "Title";
      expect(first.textContent).toContain(label);
      fireEvent.keyDown(search(), { key: "Enter" });
      expect(details(label)).not.toBeNull();
      fireEvent.keyDown(search(), { key: "Enter" });
      expect(details(label)).toBeNull();
      fireEvent.keyDown(search(), { key: "Enter", ctrlKey: true });
      expect(page.texts).toHaveLength(1);
      expect(page.host.calls.notices).toEqual([`Inserted ${label}.`]);
      expect(panel()).toBeNull();
    });

    it("close as Insert inserts the field and announces it", () => {
      using page = open({ size });
      page.pressAction();
      clickRow("Title");
      fireEvent.click(
        within(details()!).getByRole("button", { name: "Insert" }),
        { shiftKey: true },
      );
      expect(page.texts).toEqual([TITLE]);
      expect(details()).toBeNull();
      expect(page.host.calls.notices).toEqual(["Inserted Title."]);
    });

    it("close as Copy copies the snippet and announces it", () => {
      using page = open({ size });
      page.pressAction();
      clickRow("Title");
      const copyButton = within(details()!).getByRole("button", {
        name: "Copy",
      });
      act(() => copyButton.focus());
      fireEvent.click(copyButton);
      expect(page.host.calls.copies).toEqual(["{{ zt.title }}"]);
      expect(details()).toBeNull();
      // Focus the details held goes back to the search.
      expect(document.activeElement).toBe(search());
      expect(page.host.calls.notices).toEqual(["Copied Title."]);
      // The Fields popover stays open.
      expect(panel()).not.toBeNull();
    });

    it("close on a press outside them and their row, and stay on a press inside", () => {
      using page = open({ size });
      page.pressAction();
      clickRow("Title");
      fireEvent.pointerDown(details()!);
      expect(details()).not.toBeNull();
      fireEvent.pointerDown(rowOf("Title").querySelector("[data-part=row]")!);
      expect(details()).not.toBeNull();
      fireEvent.pointerDown(doiRow());
      expect(details()).toBeNull();
      expect(panel()).not.toBeNull();
    });

    it("close on Escape first, then Escape clears the search, then closes the popover", () => {
      using page = open({ size });
      page.pressAction();
      fireEvent.change(search(), { target: { value: "ti" } });
      clickRow("Title");
      fireEvent.keyDown(search(), { key: "Escape" });
      expect(details()).toBeNull();
      expect(search()).toHaveProperty("value", "ti");
      fireEvent.keyDown(search(), { key: "Escape" });
      expect(search()).toHaveProperty("value", "");
      expect(panel()).not.toBeNull();
      fireEvent.keyDown(search(), { key: "Escape" });
      expect(panel()).toBeNull();
    });
  },
);

describe("a field row", () => {
  it("marks a field with no value as empty for this item", () => {
    using page = open({
      data: { title: "Linked notes in practice", abstract: "", DOI: null },
    });
    page.pressAction();
    for (const key of ["abstract", "DOI"]) {
      const row = within(panel()!)
        .getAllByRole("treeitem")
        .find((item) => item.getAttribute("data-workbench-field") === key)!;
      expect(row.textContent).toContain("Empty for this item");
      expect(row.textContent).not.toContain("null");
    }
  });

  it("inserts from its Insert button, which draws the insert icon", () => {
    using page = open();
    page.pressAction();
    const button = within(titleRow()).getByRole("button", {
      name: "Insert field",
    });
    expect(button.querySelector("[data-icon=insert]")).not.toBeNull();
    insertTitle();
    expect(page.texts).toEqual([TITLE]);
    expect(page.host.calls.notices).toEqual(["Inserted Title."]);
  });

  it("offers no Insert where the editor takes no field", () => {
    using page = open({ disabled: true });
    page.pressAction();
    clickRow("Title");
    expect(
      within(titleRow()).queryByRole("button", { name: "Insert field" }),
    ).toBeNull();
    expect(
      within(details()!).getByRole("button", { name: "Insert" }),
    ).toHaveProperty("disabled", true);
    fireEvent.keyDown(search(), { key: "ArrowDown" });
    fireEvent.keyDown(search(), { key: "Enter", metaKey: true });
    expect(page.texts).toEqual([]);
  });

  it("leaves Enter to an input method composing in the search", () => {
    using page = open();
    page.pressAction();
    fireEvent.keyDown(search(), { key: "ArrowDown" });
    fireEvent.keyDown(search(), { key: "Enter", isComposing: true });
    fireEvent.keyDown(search(), { key: "Enter", keyCode: 229, ctrlKey: true });
    expect(details()).toBeNull();
    expect(details("DOI")).toBeNull();
    expect(page.texts).toEqual([]);
  });

  it("names the keys in the panel's footer", () => {
    using page = open();
    page.pressAction();
    expect(
      within(panel()!).getByText(
        /^Select or press Enter: details · (Ctrl|Command)\+Enter: insert$/,
      ),
    ).toBeTruthy();
  });
});

describe("a field's details in the docked panel", () => {
  const wide = { size: { width: 1200, height: 800 }, panels: PINNED };
  const dockedRow = (label: string) =>
    within(docked()!)
      .getAllByRole("treeitem")
      .find((row) => row.textContent?.includes(label))!
      .querySelector<HTMLElement>("[data-part=row]")!;
  const dockedSearch = () => within(docked()!).getByRole("combobox");
  const dockedDetails = (label = "Title") =>
    within(docked()!).queryByRole("region", { name: label });

  it("open in the host's popover beside the docked panel", () => {
    using _page = open(wide);
    fireEvent.click(dockedRow("Title"));
    const region = dockedDetails()!;
    const popover = region.closest<HTMLElement>("[data-fake-details]")!;
    expect(popover.dataset.beside).toBe("docked");
    expect(popover.dataset.anchor).toBe("title");
  });

  it("close on Escape, then Escape clears the search, and the panel stays", () => {
    using page = open(wide);
    fireEvent.change(dockedSearch(), { target: { value: "ti" } });
    fireEvent.click(dockedRow("Title"));
    fireEvent.keyDown(dockedSearch(), { key: "Escape" });
    expect(dockedDetails()).toBeNull();
    expect(dockedSearch()).toHaveProperty("value", "ti");
    fireEvent.keyDown(dockedSearch(), { key: "Escape" });
    expect(dockedSearch()).toHaveProperty("value", "");
    // No popover to close: the panel stays docked.
    const third = fireEvent.keyDown(dockedSearch(), { key: "Escape" });
    expect(third).toBe(true);
    expect(docked()).not.toBeNull();
    expect(page.isOpen()).toBe(true);
  });

  it("insert with Mod+Enter on the selected row and with Insert, and the panel stays", () => {
    using page = open(wide);
    fireEvent.keyDown(dockedSearch(), { key: "ArrowDown" });
    fireEvent.keyDown(dockedSearch(), { key: "Enter", metaKey: true });
    expect(page.texts).toEqual([TITLE]);
    fireEvent.click(dockedRow("Title"));
    fireEvent.click(
      within(dockedDetails()!).getByRole("button", { name: "Insert" }),
    );
    expect(page.texts).toEqual([TITLE, TITLE]);
    expect(dockedDetails()).toBeNull();
    expect(docked()).not.toBeNull();
  });
});

describe("a nested field", () => {
  it("goes by one name in its details and in what Insert and Copy announce", () => {
    using page = open({ size: { width: 760, height: 800 } });
    page.pressAction();
    fireEvent.click(
      within(rowOf("shelf")).getByRole("button", { name: "Toggle node" }),
    );
    const nested = () =>
      within(panel()!)
        .getAllByRole("treeitem")
        .find(
          (row) => row.getAttribute("data-workbench-field") === "shelf.label",
        )!
        .querySelector<HTMLElement>("[data-part=row]")!;
    // The details title the nested field by its key.
    const name = "label";
    fireEvent.click(nested());
    expect(details(name)).not.toBeNull();
    fireEvent.click(
      within(details(name)!).getByRole("button", { name: "Copy" }),
    );
    fireEvent.click(nested());
    fireEvent.click(
      within(details(name)!).getByRole("button", { name: "Insert" }),
      { shiftKey: true },
    );
    expect(page.host.calls.notices).toEqual([
      `Copied ${name}.`,
      `Inserted ${name}.`,
    ]);
  });
});

/** A paper with a list of creators, a list of plain tags, and a list of files. */
const LISTS = {
  title: "Linked notes in practice",
  authors: [
    withText(
      { family: "Ahrens", given: "Sönke", literal: null },
      "Sönke Ahrens",
    ),
    withText(
      { family: "Luhmann", given: "Niklas", literal: null },
      "Niklas Luhmann",
    ),
  ],
  tags: ["methods", "zettelkasten"],
  attachments: [{ filename: "ahrens.pdf" }, { filename: "luhmann.pdf" }],
};

describe("a list field", () => {
  const lists = { size: { width: 760, height: 800 }, data: LISTS };
  /** The tree item of the field whose key is `key`. */
  const item = (key: string) =>
    within(panel()!)
      .queryAllByRole("treeitem")
      .find((row) => row.getAttribute("data-workbench-field") === key);
  const line = (key: string) =>
    item(key)!.querySelector<HTMLElement>(":scope > [data-part=row]")!;
  const toggle = (key: string) =>
    within(line(key)).queryByRole("button", { name: "Toggle node" });

  // Final review of spec #1962 (B3), story 19: a search finds a field by its
  // template path as well as by its name and its value.
  it.each([
    ["zt.title", "title"],
    ["zt.authors", "authors"],
    ["authors.family", "authors[].family"],
  ])("is found by its template path %s", (query, key) => {
    using page = open(lists);
    page.pressAction();
    fireEvent.change(search(), { target: { value: query } });
    expect(item(key)).toBeDefined();
    expect(within(panel()!).queryByText(/No matching fields/)).toBeNull();
  });

  it("shows its item count and every item in one line", () => {
    using page = open(lists);
    page.pressAction();
    expect(line("authors").textContent).toContain("(2)");
    expect(line("authors").textContent).toContain(
      "Sönke Ahrens, Niklas Luhmann",
    );
    expect(line("tags").textContent).toContain("(2)");
    expect(line("tags").textContent).toContain("methods, zettelkasten");
  });

  it("opens a list of records to its properties, and a list of plain values has no chevron", () => {
    using page = open(lists);
    page.pressAction();
    expect(toggle("tags")).toBeNull();
    fireEvent.click(toggle("authors")!);
    // One sub-row for each property, with that property for every item.
    expect(line("authors[].family").textContent).toContain("Ahrens, Luhmann");
    expect(line("authors[].given").textContent).toContain("Sönke, Niklas");
    // A property no item has a value for reads as empty.
    expect(line("authors[].literal").textContent).toContain(
      "Empty for this item",
    );
    // The list row keeps its items in view while it stands open.
    expect(line("authors").textContent).toContain(
      "Sönke Ahrens, Niklas Luhmann",
    );
    // No row names one item by its index.
    const keys = within(panel()!)
      .getAllByRole("treeitem")
      .map((row) => row.getAttribute("data-workbench-field")!);
    expect(keys.filter((key) => /\[\d+\]/.test(key))).toEqual([]);
  });

  /** The details of the field `key`, after a click on its row. */
  const openDetails = (key: string, label: string) => {
    fireEvent.click(line(key));
    return within(details(label)!);
  };
  /** The forms the details offer, the chosen one marked. */
  const forms = (region: ReturnType<typeof openDetails>) =>
    region
      .queryAllByRole("radio")
      .map(
        (radio) =>
          `${radio.closest("label")!.textContent}${(radio as HTMLInputElement).checked ? " ✓" : ""}`,
      );

  it("shows the list's values in its details, one per line and numbered", () => {
    using page = open(lists);
    page.pressAction();
    const region = openDetails("authors", "Authors");
    const values = region.getByRole("list");
    expect(
      within(values)
        .getAllByRole("listitem")
        .map((value) => value.textContent),
    ).toEqual(["1Sönke Ahrens", "2Niklas Luhmann"]);
  });

  it("puts a list into the note in one line or for each item, as the reader chooses", () => {
    using page = open(lists);
    page.pressAction();
    let region = openDetails("authors", "Authors");
    expect(
      region.getByRole("radiogroup", { name: "In your note" }),
    ).toBeTruthy();
    expect(forms(region)).toEqual(["In one line ✓", "Each item"]);
    expect(region.getByText('{{ zt.authors | join: ", " }}')).toBeTruthy();
    expect(region.getByText("Sönke Ahrens, Niklas Luhmann")).toBeTruthy();
    fireEvent.click(region.getByRole("radio", { name: "Each item" }));
    expect(forms(region)).toEqual(["In one line", "Each item ✓"]);
    const loop = "{% for author in zt.authors %}\n- {{ author }}{% endfor %}";
    expect(
      region.getByText((_, element) => element?.textContent === loop, {
        selector: "code",
      }),
    ).toBeTruthy();
    expect(
      region.getByText(
        (_, element) =>
          element?.textContent === "- Sönke Ahrens\n- Niklas Luhmann",
        { selector: "span" },
      ),
    ).toBeTruthy();
    fireEvent.click(region.getByRole("button", { name: "Copy" }));
    region = openDetails("authors", "Authors");
    fireEvent.click(region.getByRole("radio", { name: "Each item" }));
    fireEvent.click(region.getByRole("button", { name: "Insert" }), {
      shiftKey: true,
    });
    expect(page.host.calls.copies).toEqual([loop]);
    expect(page.texts).toEqual([loop]);
  });

  it("offers a list property in both forms", () => {
    using page = open(lists);
    page.pressAction();
    fireEvent.click(toggle("authors")!);
    const region = openDetails("authors[].family", "family");
    expect(
      within(region.getByRole("list"))
        .getAllByRole("listitem")
        .map((value) => value.textContent),
    ).toEqual(["1Ahrens", "2Luhmann"]);
    // A path names the list, then the property each item has.
    expect(region.getByText("zt.authors → each item's family")).toBeTruthy();
    expect(region.queryByText("zt.authors.family")).toBeNull();
    expect(forms(region)).toEqual(["In one line ✓", "Each item"]);
    fireEvent.click(region.getByRole("button", { name: "Insert" }), {
      shiftKey: true,
    });
    expect(page.texts).toEqual([
      '{{ zt.authors | map: "family" | join: ", " }}',
    ]);
  });

  it("offers each item alone where the items do not read as text, and the row's Insert uses it", () => {
    using page = open(lists);
    page.pressAction();
    const region = openDetails("attachments", "Attached files");
    expect(forms(region)).toEqual(["Each item ✓"]);
    fireEvent.click(
      within(line("attachments")).getByRole("button", {
        name: "Insert field",
      }),
      { shiftKey: true },
    );
    expect(page.texts).toEqual([
      "{% for attachment in zt.attachments %}\n- {{ attachment.filename }}{% endfor %}",
    ]);
  });

  it("offers no form choice for a field that is not a list", () => {
    using page = open(lists);
    page.pressAction();
    expect(forms(openDetails("title", "Title"))).toEqual([]);
  });
});

describe("the Fields Panel's sections", () => {
  const PRESENTED = [
    { presentation: "Fields popover", options: {}, surface: () => panel()! },
    {
      presentation: "docked panel",
      options: { size: { width: 1200, height: 800 }, panels: PINNED },
      surface: () => docked()!,
    },
  ] as const;
  const showing = (options: (typeof PRESENTED)[number]["options"]) => {
    const page = open(options);
    if (!docked()) page.pressAction();
    return page;
  };
  const rowFor = (surface: HTMLElement, key: string) =>
    within(surface)
      .getAllByRole("treeitem")
      .find((row) => row.getAttribute("data-workbench-field") === key)!;
  /**
   * The header of the Reference section, which holds `shelf`, a field the
   * taxonomy does not name, as its one field.
   */
  const reference = (surface: HTMLElement) =>
    within(surface).getByRole("button", { name: "Reference 1" });
  const fieldShown = (surface: HTMLElement, key: string) =>
    within(surface)
      .queryAllByRole("treeitem")
      .some((row) => row.getAttribute("data-workbench-field") === key);

  describe.each(PRESENTED)("in the $presentation", ({ options, surface }) => {
    it("head each group with its icon, its label, its count and a chevron", () => {
      using _page = showing(options);
      const header = reference(surface());
      const part = (name: string) =>
        header.querySelector(`[data-part=${name}]`);
      expect(
        part("section-icon")?.querySelector("[data-icon=section-reference]"),
      ).not.toBeNull();
      expect(part("section-label")?.textContent).toBe("Reference");
      expect(part("section-count")?.textContent).toBe("1");
      expect(part("section-chevron")).not.toBeNull();
    });

    it("collapse and expand a group on a click on its header", () => {
      using _page = showing(options);
      const header = reference(surface());
      expect(header.getAttribute("aria-expanded")).toBe("true");
      fireEvent.click(header);
      expect(header.getAttribute("aria-expanded")).toBe("false");
      expect(fieldShown(surface(), "shelf")).toBe(false);
      fireEvent.click(header);
      expect(fieldShown(surface(), "shelf")).toBe(true);
    });

    it("count the group's own fields, which an opened field leaves as it was", () => {
      using _page = showing(options);
      expect(reference(surface())).toBeTruthy();
      fireEvent.click(
        within(rowFor(surface(), "shelf")).getByRole("button", {
          name: "Toggle node",
        }),
      );
      expect(fieldShown(surface(), "shelf.label")).toBe(true);
      // Still one field of its own, with its nested field open.
      expect(reference(surface())).toBeTruthy();
    });

    it("collapse and expand every group from the panel's header", () => {
      using _page = showing(options);
      const header =
        surface().querySelector<HTMLElement>("[data-part=header]")!;
      fireEvent.click(
        within(header).getByRole("button", { name: "Collapse all sections" }),
      );
      expect(within(surface()).queryAllByRole("treeitem")).toEqual([]);
      // The same button now says what it does next.
      fireEvent.click(
        within(header).getByRole("button", { name: "Expand all sections" }),
      );
      expect(fieldShown(surface(), "title")).toBe(true);
      expect(fieldShown(surface(), "shelf")).toBe(true);
      // The search row holds the search alone.
      expect(
        within(surface())
          .getByRole("combobox")
          .closest("[data-part=search-row]")!
          .querySelector("button"),
      ).toBeNull();
    });

    it("open every group with a match while the reader searches", () => {
      using _page = showing(options);
      fireEvent.click(
        within(surface()).getByRole("button", {
          name: "Collapse all sections",
        }),
      );
      fireEvent.change(within(surface()).getByRole("combobox"), {
        target: { value: "e" },
      });
      // "Title" and "shelf" match, in two groups.
      expect(fieldShown(surface(), "title")).toBe(true);
      expect(fieldShown(surface(), "shelf")).toBe(true);
      // Every group the search shows stands open.
      const headers = [
        ...surface().querySelectorAll("[data-part=section-header]"),
      ];
      expect(headers.length).toBeGreaterThan(1);
      for (const header of headers)
        expect(header.getAttribute("aria-expanded")).toBe("true");
    });
  });
});

describe("a Fields Panel row", () => {
  /** The label cell of the row for the field `key`. */
  const labelCell = (key: string) =>
    within(panel()!)
      .getAllByRole("treeitem")
      .find((row) => row.getAttribute("data-workbench-field") === key)!
      .querySelector<HTMLElement>(
        ":scope > [data-part=row] [data-part=field-label]",
      )!;

  it("holds the field's label in its label cell, with the chevron of a field that opens", () => {
    using page = open();
    page.pressAction();
    expect(within(labelCell("title")).getByText("Title")).toBeTruthy();
    expect(
      within(labelCell("title")).queryByRole("button", { name: "Toggle node" }),
    ).toBeNull();
    expect(
      within(labelCell("shelf")).getByRole("button", { name: "Toggle node" }),
    ).toBeTruthy();
  });

  it("marks a nested field's label, which the host draws behind a guide line", () => {
    using page = open();
    page.pressAction();
    expect(labelCell("title").getAttribute("data-state")).toBeNull();
    fireEvent.click(
      within(labelCell("shelf")).getByRole("button", { name: "Toggle node" }),
    );
    expect(labelCell("shelf.label").getAttribute("data-state")).toBe("nested");
  });
});

// Final review of spec #1962 (A1): the details, Copy, Insert and Mod+Enter
// write one text, in the syntax of the place the insert writes to.
describe("a field's text follows the place an insert writes to", () => {
  it.each([
    {
      place: "an Eta template",
      insertion: { engine: "eta", mode: "template" },
      text: "<%= zt.title %>",
    },
    {
      place: "a Properties expression",
      insertion: { engine: "liquid", mode: "expression" },
      text: "zt.title",
    },
  ] as const)(
    "shows, copies and inserts one text in $place",
    ({ insertion, text }) => {
      using page = open({ size: { width: 760, height: 800 }, insertion });
      page.pressAction();
      clickRow("Title");
      expect(details()!.querySelector("[data-part=snippet]")!.textContent).toBe(
        text,
      );
      fireEvent.click(within(details()!).getByRole("button", { name: "Copy" }));
      expect(page.host.calls.copies).toEqual([text]);
      clickRow("Title");
      fireEvent.click(
        within(details()!).getByRole("button", { name: "Insert" }),
        { shiftKey: true },
      );
      // The row the click selected stays selected: the first, Title.
      fireEvent.keyDown(search(), { key: "ArrowUp" });
      fireEvent.keyDown(search(), { key: "Enter", ctrlKey: true });
      expect(page.texts).toEqual([text, text]);
    },
  );
});
