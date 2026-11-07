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
  preview: { ...INITIAL_PANELS.preview, shown: true },
};

/**
 * The explorer the hosts put in the Fields Panel, over its own navigation.
 * With `redraw`, each insert draws the tree anew, as a host's can.
 */
function Fields({
  onInsertNode,
  redraw = false,
}: {
  onInsertNode: (node: DisplayNode) => boolean | void;
  redraw?: boolean;
}) {
  const [drawn, setDrawn] = useState(0);
  const [collapsedSections, setCollapsedSections] = useState<
    ReadonlySet<string>
  >(() => new Set<string>());
  const [navigation, setNavigation] = useState(initialTreeState);
  return (
    <DataExplorer
      key={drawn}
      root="note"
      data={PAPER}
      copy={() => Effect.void}
      collapsedSections={collapsedSections}
      onCollapsedSectionsChange={setCollapsedSections}
      navigation={navigation}
      onNavigationChange={setNavigation}
      onInsertNode={(node) => {
        if (redraw) setDrawn((count) => count + 1);
        return onInsertNode(node);
      }}
    />
  );
}

function open({
  size = { width: 560, height: 800 },
  refuse = false,
  redraw = false,
}: { size?: ViewSize; refuse?: boolean; redraw?: boolean } = {}) {
  const viewSize = Atom.make<ViewSize | null>(size);
  const inserted: string[] = [];
  const mounted = mount(
    <SidePanels
      panels={{
        fields: {
          label: "Fields",
          content: (
            <Fields
              redraw={redraw}
              onInsertNode={(node) => {
                if (refuse) return false;
                inserted.push(node.key);
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

  it("closes on the host's Escape and outside press, and on its Close button, with focus back to the Fields action", () => {
    using page = open();
    page.pressAction();
    fireEvent.keyDown(within(panel()!).getByRole("searchbox"), {
      key: "Escape",
    });
    expect(panel()).toBeNull();
    expect(returnedFocus()).toBe("true");
    page.pressAction();
    fireEvent.pointerDown(screen.getByLabelText("Template source"));
    expect(panel()).toBeNull();
    expect(returnedFocus()).toBe("true");
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
    expect(panel()).not.toBeNull();
    // Shift+Enter on the button keeps it open as well.
    fireEvent.keyDown(
      within(titleRow()).getByRole("button", { name: "Insert field" }),
      { key: "Enter", shiftKey: true },
    );
    expect(page.inserted).toEqual(["title", "title"]);
    expect(panel()).not.toBeNull();
  });

  it("keeps focus on the field's Insert button when a Shift insert draws its row again", async () => {
    using page = open({ redraw: true });
    page.pressAction();
    const insert = () =>
      within(titleRow()).getByRole("button", { name: "Insert field" });
    const first = insert();
    act(() => first.focus());
    fireEvent.keyDown(first, { key: "Enter", shiftKey: true });
    // The row is a new element now, and focus followed it.
    await act(async () => {});
    expect(insert()).not.toBe(first);
    expect(document.activeElement).toBe(insert());
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
