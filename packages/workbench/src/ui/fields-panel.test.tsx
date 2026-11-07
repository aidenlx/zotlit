import type { DisplayNode } from "#/explorer/index";
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
import { fieldsActionAttributes } from "./fields-panel";
import { useWorkbenchHost } from "./host";
import { pressFieldsAction } from "./model";
import { INITIAL_PANELS } from "./panel-layout";
import type { ViewSize, WorkbenchPanels } from "./panel-layout";
import { SidePanels } from "./panels";
import { mount } from "./test-host";

import { initialTreeState } from "#/explorer/index";

afterEach(cleanup);

const PAPER = {
  title: "Linked notes in practice",
  DOI: "10.1000/linked-notes",
  abstract: "",
};

const PREVIEW: WorkbenchPanels = {
  preview: { ...INITIAL_PANELS.preview, shown: true },
};

/** The explorer the hosts put in the Fields Panel, over its own navigation. */
function Fields({
  onInsertNode,
  disabled = false,
}: {
  disabled?: boolean;
  onInsertNode: (
    node: DisplayNode,
    options: { keepOpen: boolean },
  ) => boolean | void;
}) {
  const [collapsedSections, setCollapsedSections] = useState<
    ReadonlySet<string>
  >(() => new Set<string>());
  const [navigation, setNavigation] = useState(initialTreeState);
  const host = useWorkbenchHost();
  return (
    <DataExplorer
      root="note"
      data={PAPER}
      copy={(text) => host.copy!(text)}
      collapsedSections={collapsedSections}
      onCollapsedSectionsChange={setCollapsedSections}
      navigation={navigation}
      onNavigationChange={setNavigation}
      onInsertNode={onInsertNode}
      disabled={disabled}
    />
  );
}

function open({
  size = { width: 560, height: 800 },
  refuse = false,
  disabled = false,
}: { size?: ViewSize; refuse?: boolean; disabled?: boolean } = {}) {
  const viewSize = Atom.make<ViewSize | null>(size);
  const inserted: string[] = [];
  const keptOpen: boolean[] = [];
  const mounted = mount(
    <SidePanels
      panels={{
        fields: {
          label: "Fields",
          content: (
            <Fields
              disabled={disabled}
              onInsertNode={(node, { keepOpen }) => {
                if (refuse) return false;
                inserted.push(node.key);
                keptOpen.push(keepOpen);
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
    { panels: PREVIEW, viewSize },
  );
  render(mounted.ui);
  return Object.assign(mounted, {
    inserted,
    keptOpen,
    resize: (next: ViewSize) => act(() => mounted.registry.set(viewSize, next)),
    pressAction: () =>
      act(() => pressFieldsAction(mounted.registry, mounted.model)),
    isOpen: () => mounted.registry.get(mounted.model.fieldsAction).open,
  });
}

/** The Fields Panel on the host's popover. */
const panel = () => screen.queryByRole("dialog", { name: "Fields" });
/** Whether focus went back to the Fields action as the popover last closed. */
const returnedFocus = () =>
  document
    .querySelector("[data-return-focus]")
    ?.getAttribute("data-return-focus");
const titleRow = () =>
  within(panel()!)
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
    expect(page.inserted).toEqual(["title"]);
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
    expect(page.inserted).toEqual(["title"]);
    // The host keeps focus off the editor for the next field.
    expect(page.keptOpen).toEqual([true]);
    expect(panel()).not.toBeNull();
    // Shift+Enter on the button keeps it open as well.
    fireEvent.keyDown(
      within(titleRow()).getByRole("button", { name: "Insert field" }),
      { key: "Enter", shiftKey: true },
    );
    expect(page.inserted).toEqual(["title", "title"]);
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

describe("the Fields action's state", () => {
  it("reads as a disclosure of the panel it opens", () => {
    expect(fieldsActionAttributes({ open: false }, "fields")).toEqual({
      "aria-haspopup": "dialog",
      "aria-expanded": "false",
      "aria-controls": undefined,
    });
    expect(fieldsActionAttributes({ open: true }, "fields")).toEqual({
      "aria-haspopup": "dialog",
      "aria-expanded": "true",
      "aria-controls": "fields",
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
      clickRow("Title");
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
      expect(region.getByText("In your note:")).toBeTruthy();
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
      expect(page.inserted).toHaveLength(1);
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
      expect(page.inserted).toEqual(["title"]);
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
  it("inserts from its Insert button, which draws the insert icon", () => {
    using page = open();
    page.pressAction();
    const button = within(titleRow()).getByRole("button", {
      name: "Insert field",
    });
    expect(button.querySelector("[data-icon=insert]")).not.toBeNull();
    insertTitle();
    expect(page.inserted).toEqual(["title"]);
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
    expect(page.inserted).toEqual([]);
  });

  it("leaves Enter to an input method composing in the search", () => {
    using page = open();
    page.pressAction();
    fireEvent.keyDown(search(), { key: "ArrowDown" });
    fireEvent.keyDown(search(), { key: "Enter", isComposing: true });
    fireEvent.keyDown(search(), { key: "Enter", keyCode: 229, ctrlKey: true });
    expect(details()).toBeNull();
    expect(details("DOI")).toBeNull();
    expect(page.inserted).toEqual([]);
  });

  it("names the keys in the panel's footer", () => {
    using page = open();
    page.pressAction();
    expect(
      within(panel()!).getByText(
        /^Click or Enter: details · (Ctrl|Command)\+Enter: insert$/,
      ),
    ).toBeTruthy();
  });
});
