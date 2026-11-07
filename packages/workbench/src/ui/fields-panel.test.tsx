import type { DisplayNode } from "#/explorer/index";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { Effect } from "effect";
import * as Atom from "effect/reactivity/Atom";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { DataExplorer } from "./data-explorer";
import { fieldsActionAttributes } from "./fields-panel";
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
};

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
  onInsertNode,
}: {
  onInsertNode: (
    node: DisplayNode,
    options: { keepOpen: boolean },
  ) => boolean | void;
}) {
  const [collapsedSections, setCollapsedSections] = useState<
    ReadonlySet<string>
  >(() => new Set<string>());
  const [navigation, setNavigation] = useState(initialTreeState);
  return (
    <DataExplorer
      root="note"
      data={PAPER}
      copy={() => Effect.void}
      collapsedSections={collapsedSections}
      onCollapsedSectionsChange={setCollapsedSections}
      navigation={navigation}
      onNavigationChange={setNavigation}
      onInsertNode={onInsertNode}
    />
  );
}

function open({
  size = { width: 560, height: 800 },
  refuse = false,
  panels = PREVIEW,
}: { size?: ViewSize; refuse?: boolean; panels?: WorkbenchPanels } = {}) {
  const viewSize = Atom.make<ViewSize | null>(size);
  const inserted: string[] = [];
  const keptOpen: boolean[] = [];
  const mounted = mount(
    <SidePanels
      panels={{
        fields: {
          label: "Fields",
          resizeLabel: "Resize fields",
          content: (
            <Fields
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
    { panels, viewSize },
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
    expect(document.activeElement).toBe(
      within(panel()!).getByRole("searchbox"),
    );
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
      within(docked()!).getByRole("searchbox"),
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
    expect(page.inserted).toEqual(["title"]);
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
      within(docked()!).getByRole("searchbox"),
    );
  });

  it("hands focus to the Fields action when a narrower view takes the docked panel that held it", () => {
    using page = open({ size: { width: 1200, height: 800 }, panels: PINNED });
    const search = within(docked()!).getByRole("searchbox");
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
