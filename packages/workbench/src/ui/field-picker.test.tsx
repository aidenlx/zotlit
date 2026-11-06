import type { DisplayNode } from "#/explorer/index";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as Atom from "effect/reactivity/Atom";
import { afterEach, describe, expect, it } from "vitest";

import {
  FieldPicker,
  fieldsActionAttributes,
  fieldsActionKey,
  holdPickerFocus,
} from "./field-picker";
import type { FieldPickerProps } from "./field-picker";
import { pressFieldsAction } from "./model";
import { INITIAL_PANELS } from "./panel-layout";
import type { FieldsAction, ViewSize, WorkbenchPanels } from "./panel-layout";
import { SidePanels } from "./panels";
import { mount } from "./test-host";

afterEach(cleanup);

const NARROW: ViewSize = { width: 560, height: 800 };
const WIDE: ViewSize = { width: 1400, height: 800 };
const ABSTRACT =
  "Reading notes grow with each paper. This study follows forty researchers over a year and finds that notes linked to their sources are reused twice as often.";
const PAPER = {
  title: "Linked notes in practice",
  abstract: ABSTRACT,
  DOI: "10.1000/linked-notes",
  creators: [{ firstName: "Ada", lastName: "Lovelace" }],
};

function open({
  size = NARROW,
  panels = INITIAL_PANELS,
  ...props
}: { size?: ViewSize; panels?: WorkbenchPanels } & Partial<FieldPickerProps>) {
  const viewSize = Atom.make<ViewSize | null>(size);
  const inserted: string[] = [];
  const mounted = mount(
    <SidePanels
      panels={{
        fields: {
          label: "Fields",
          resizeLabel: "Resize fields",
          content: <button type="button">Field in the column</button>,
          picker: (
            <FieldPicker
              root="note"
              data={PAPER}
              onInsertNode={(node: DisplayNode) => {
                inserted.push(node.key);
              }}
              {...props}
            />
          ),
        },
      }}
    >
      <p>Template source</p>
    </SidePanels>,
    { panels, viewSize },
  );
  render(mounted.ui);
  return Object.assign(mounted, {
    inserted,
    resize: (next: ViewSize) => act(() => mounted.registry.set(viewSize, next)),
    pressAction: () =>
      act(() => pressFieldsAction(mounted.registry, mounted.model)),
  });
}

const search = () => screen.getByRole("combobox");
const press = (key: string) => fireEvent.keyDown(search(), { key });
/** The row the search field names as active. */
const activeRow = () => {
  const id = search().getAttribute("aria-activedescendant");
  return id === null ? null : document.getElementById(id);
};

describe("a key on the Fields action", () => {
  const closed = { opens: "popover", open: false } as const;
  const key = (
    init: Partial<KeyboardEventInit> & { key: string },
    action: FieldsAction = closed,
  ) => fieldsActionKey(action, new KeyboardEvent("keydown", init));
  it("opens the picker from an arrow, and searches for a printable key", () => {
    expect(key({ key: "ArrowDown" })).toBe("");
    expect(key({ key: "ArrowUp" })).toBe("");
    expect(key({ key: "d" })).toBe("d");
    expect(key({ key: "D", shiftKey: true })).toBe("D");
  });

  it("opens nothing where the action shows the column or the picker stands", () => {
    expect(key({ key: "ArrowDown" }, { opens: "column", open: false })).toBe(
      null,
    );
    expect(key({ key: "d" }, { opens: "popover", open: true })).toBe(null);
  });

  it("leaves the action's own keys and the shortcuts alone", () => {
    for (const init of [
      { key: "Enter" },
      { key: " " },
      { key: "Tab" },
      { key: "Escape" },
      { key: "d", ctrlKey: true },
      { key: "d", metaKey: true },
      { key: "d", altKey: true },
    ])
      expect(key(init)).toBeNull();
  });
});

describe("the Fields action's state", () => {
  it("reads as a toggle where it shows the column", () => {
    expect(
      fieldsActionAttributes({ opens: "column", open: true }, "picker"),
    ).toEqual({
      "aria-pressed": "true",
      "aria-haspopup": undefined,
      "aria-expanded": undefined,
      "aria-controls": undefined,
    });
  });

  it("reads as a disclosure of the picker where it opens it", () => {
    expect(
      fieldsActionAttributes({ opens: "popover", open: false }, "picker"),
    ).toEqual({
      "aria-pressed": undefined,
      "aria-haspopup": "dialog",
      "aria-expanded": "false",
      "aria-controls": undefined,
    });
    expect(
      fieldsActionAttributes({ opens: "popover", open: true }, "picker")[
        "aria-controls"
      ],
    ).toBe("picker");
  });

  it("keeps focus in the standing picker when the pointer presses the action", () => {
    const held = (action: FieldsAction) => {
      const event = new MouseEvent("mousedown", { cancelable: true });
      holdPickerFocus(action, event);
      return event.defaultPrevented;
    };
    expect(held({ opens: "popover", open: true })).toBe(true);
    expect(held({ opens: "popover", open: false })).toBe(false);
    expect(held({ opens: "column", open: true })).toBe(false);
  });
});

describe("the Fields picker", () => {
  it("opens from the Fields action in a narrow view, with focus in its search field", () => {
    using page = open({});
    expect(screen.queryByRole("dialog")).toBeNull();
    page.pressAction();
    const picker = screen.getByRole("dialog", { name: "Fields" });
    expect(picker).toBeTruthy();
    expect(document.activeElement).toBe(search());
    expect(screen.getByRole("listbox", { name: "Fields" })).toBeTruthy();
    expect(activeRow()?.textContent).toContain("Title");
    expect(page.registry.get(page.model.fieldsAction)).toEqual({
      opens: "popover",
      open: true,
    });
  });

  it("inserts the field a search and the arrow keys reach, and announces it", () => {
    using page = open({});
    page.pressAction();
    fireEvent.change(search(), { target: { value: "doi" } });
    expect(activeRow()?.textContent).toContain("DOI");
    press("Enter");
    expect(page.inserted).toEqual(["DOI"]);
    expect(screen.queryByRole("dialog")).toBeNull();
    // The picker's own status line, before the panels' size status.
    expect(screen.getAllByRole("status")[0]!.textContent).toBe("Inserted DOI");
    expect(page.registry.get(page.model.fieldsPicker)).toBeNull();
    // The editor takes focus at the inserted text, not the Fields action.
    expect(
      document
        .querySelector("[data-return-focus]")
        ?.getAttribute("data-return-focus"),
    ).toBe("false");
  });

  it("moves the active row with the arrow keys, wrapping at either end", () => {
    using page = open({});
    page.pressAction();
    expect(activeRow()?.getAttribute("aria-selected")).toBe("true");
    press("ArrowDown");
    expect(activeRow()?.textContent).toContain("Abstract");
    press("ArrowUp");
    press("ArrowUp");
    const options = screen.getAllByRole("option");
    expect(activeRow()).toBe(options.at(-1));
    press("Home");
    expect(activeRow()).toBe(options[0]);
  });

  it("finds a nested field by its value and lists it by its path", () => {
    using page = open({});
    page.pressAction();
    fireEvent.change(search(), { target: { value: "lovelace" } });
    expect(activeRow()?.textContent).toContain("creators[0].lastName");
    press("Enter");
    expect(page.inserted).toEqual(["creators[0].lastName"]);
  });

  it("describes the active row with its whole value, under the list", () => {
    using page = open({});
    page.pressAction();
    press("ArrowDown");
    // The search field and the active row both name the detail area.
    for (const owner of [search(), activeRow()!]) {
      const detail = document.getElementById(
        owner.getAttribute("aria-describedby")!,
      );
      expect(detail?.textContent).toContain("zt.abstract");
      expect(detail?.textContent).toContain(ABSTRACT);
    }
    const others = screen
      .getAllByRole("option")
      .filter((option) => option !== activeRow());
    expect(
      others.every((option) => !option.hasAttribute("aria-describedby")),
    ).toBe(true);
  });

  it("says when a search matches nothing", () => {
    using page = open({});
    page.pressAction();
    fireEvent.change(search(), { target: { value: "no such field" } });
    expect(screen.queryAllByRole("option")).toEqual([]);
    expect(activeRow()).toBeNull();
    expect(screen.getByRole("dialog").textContent).toContain(
      "No matching fields",
    );
  });

  it("asks for a place in the template while the editor takes no field", () => {
    using page = open({ disabled: true });
    page.pressAction();
    // The search field reads the reason with the active row.
    const described = search()
      .getAttribute("aria-describedby")!
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "");
    expect(described).toContain(
      "Select a place in the template to insert a field.",
    );
    press("Enter");
    expect(page.inserted).toEqual([]);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("stays open when the editor refuses the field", () => {
    using page = open({ onInsertNode: () => false });
    page.pressAction();
    press("Enter");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getAllByRole("status")[0]!.textContent).toBe("");
  });

  it("opens on the search the reader started on the Fields action", () => {
    using page = open({});
    act(() => page.registry.set(page.model.fieldsPicker, { query: "doi" }));
    expect((search() as HTMLInputElement).value).toBe("doi");
    expect(activeRow()?.textContent).toContain("DOI");
  });

  it("keeps the list out of the Tab order", () => {
    using page = open({});
    page.pressAction();
    expect(screen.getByRole("listbox").getAttribute("tabindex")).toBe("-1");
  });

  it("starts each opening over, from the whole list", () => {
    using page = open({});
    page.pressAction();
    fireEvent.change(search(), { target: { value: "doi" } });
    press("Escape");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      document
        .querySelector("[data-return-focus]")
        ?.getAttribute("data-return-focus"),
    ).toBe("true");
    page.pressAction();
    expect((search() as HTMLInputElement).value).toBe("");
    expect(activeRow()?.textContent).toContain("Title");
  });

  it("leaves the picker closed and the column hidden when a view with the Fields Panel shown narrows", () => {
    using page = open({
      size: WIDE,
      panels: {
        ...INITIAL_PANELS,
        fields: { ...INITIAL_PANELS.fields, shown: true },
      },
    });
    expect(screen.getByRole("region", { name: "Fields" })).toBeTruthy();
    page.resize(NARROW);
    expect(screen.queryByRole("region", { name: "Fields" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    page.resize(WIDE);
    expect(screen.getByRole("region", { name: "Fields" })).toBeTruthy();
  });

  it("closes when the view widens, and the column shows again", () => {
    using page = open({
      panels: {
        ...INITIAL_PANELS,
        fields: { ...INITIAL_PANELS.fields, shown: true },
      },
    });
    page.pressAction();
    expect(screen.getByRole("dialog")).toBeTruthy();
    page.resize(WIDE);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("region", { name: "Fields" })).toBeTruthy();
    page.resize(NARROW);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("hands focus to the Fields action when a resize takes away the column that held it", () => {
    using page = open({
      size: WIDE,
      panels: {
        ...INITIAL_PANELS,
        fields: { ...INITIAL_PANELS.fields, shown: true },
      },
    });
    screen.getByRole("button", { name: "Field in the column" }).focus();
    page.resize(NARROW);
    expect(page.host.calls.actionFocuses).toBe(1);
  });

  it("leaves focus alone when the column goes while focus is elsewhere", () => {
    using page = open({
      size: WIDE,
      panels: {
        ...INITIAL_PANELS,
        fields: { ...INITIAL_PANELS.fields, shown: true },
      },
    });
    page.resize(NARROW);
    expect(page.host.calls.actionFocuses).toBe(0);
  });
});
