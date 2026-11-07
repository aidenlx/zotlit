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
import { fieldsActionAttributes } from "./fields-sheet";
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
 * The explorer the hosts put in the sheet, over its own navigation. With
 * `redraw`, each insert draws the tree anew, as a host's can.
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
          content: "Rendered note",
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

const sheet = () => screen.queryByRole("dialog", { name: "Fields" });
const titleRow = () =>
  within(sheet()!)
    .getAllByRole("treeitem")
    .find((row) => row.textContent?.includes("Title"))!;
const insertTitle = (init?: MouseEventInit) =>
  fireEvent.click(
    within(titleRow()).getByRole("button", { name: "Insert field" }),
    init,
  );

describe("the Fields sheet", () => {
  it.each([320, 560, 760, 960, 1200])(
    "opens from the Fields action over a %i px view, and a second press closes it",
    (width) => {
      using page = open({ size: { width, height: 800 } });
      expect(sheet()).toBeNull();
      page.pressAction();
      const dialog = sheet()!;
      expect(dialog.getAttribute("aria-modal")).toBe("true");
      expect(dialog.id).toBe("fake-fields-sheet");
      expect(page.registry.get(page.model.placement).fields).toBe("sheet");
      page.pressAction();
      expect(sheet()).toBeNull();
      expect(page.registry.get(page.model.placement).fields).toBe("closed");
    },
  );

  it("puts focus in its search field and holds the editor and the Preview out of reach", () => {
    using page = open();
    page.pressAction();
    expect(document.activeElement).toBe(
      within(sheet()!).getByRole("searchbox"),
    );
    const editor = screen.getByLabelText("Template source");
    expect(editor.closest("[inert]")).not.toBeNull();
    expect(screen.getByText("Rendered note").closest("[inert]")).not.toBeNull();
    page.pressAction();
    expect(editor.closest("[inert]")).toBeNull();
  });

  it("keeps Tab inside the sheet", () => {
    using page = open();
    page.pressAction();
    const dialog = sheet()!;
    const close = within(dialog).getByRole("button", { name: "Close" });
    const search = within(dialog).getByRole("searchbox");
    close.focus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    // The close button is the first stop; Shift+Tab wraps to the last.
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(close);
    const last = document.activeElement as HTMLElement;
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    expect(search).toBeTruthy();
  });

  it("closes on Escape and on the scrim, and hands focus to the Fields action", () => {
    using page = open();
    page.pressAction();
    fireEvent.keyDown(within(sheet()!).getByRole("searchbox"), {
      key: "Escape",
    });
    expect(sheet()).toBeNull();
    expect(page.host.calls.actionFocuses).toBe(1);
    page.pressAction();
    fireEvent.click(document.querySelector("[data-part=scrim]")!);
    expect(sheet()).toBeNull();
    expect(page.host.calls.actionFocuses).toBe(2);
  });

  it("closes once it inserts a field, and leaves focus to the editor", () => {
    using page = open();
    page.pressAction();
    insertTitle();
    expect(page.inserted).toEqual(["title"]);
    expect(sheet()).toBeNull();
    expect(page.host.calls.actionFocuses).toBe(0);
  });

  it("stays open for the next field on a Shift-click of Insert", () => {
    using page = open();
    page.pressAction();
    insertTitle({ shiftKey: true });
    expect(page.inserted).toEqual(["title"]);
    expect(sheet()).not.toBeNull();
    // Shift+Enter on the button keeps it open as well.
    fireEvent.keyDown(
      within(titleRow()).getByRole("button", { name: "Insert field" }),
      { key: "Enter", shiftKey: true },
    );
    expect(page.inserted).toEqual(["title", "title"]);
    expect(sheet()).not.toBeNull();
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
    expect(sheet()).not.toBeNull();
  });

  it("never opens or closes as the view changes size", () => {
    using page = open({ size: { width: 1200, height: 800 } });
    page.resize({ width: 320, height: 400 });
    expect(page.isOpen()).toBe(false);
    page.pressAction();
    page.resize({ width: 1200, height: 900 });
    expect(page.isOpen()).toBe(true);
    expect(sheet()).not.toBeNull();
  });
});

describe("the Fields action's state", () => {
  it("reads as a disclosure of the sheet it opens", () => {
    expect(fieldsActionAttributes({ open: false }, "sheet")).toEqual({
      "aria-haspopup": "dialog",
      "aria-expanded": "false",
      "aria-controls": undefined,
    });
    expect(fieldsActionAttributes({ open: true }, "sheet")).toEqual({
      "aria-haspopup": "dialog",
      "aria-expanded": "true",
      "aria-controls": "sheet",
    });
  });
});
