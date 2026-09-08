import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EditToolbar } from "./edit-toolbar";
import { ProblemsFooter } from "./problems-footer";
import { createWorkbenchStore } from "./store";
import { TabBar, TabPanel } from "./tab-bar";
import { mount, renderWithMessages as render } from "./test-host";
import { m } from "./test-messages";

import { WorkbenchDocumentController } from "#/document/controller";
import { DEFAULT_PROFILE_SOURCE } from "#/render/default-profile";

afterEach(cleanup);

function tabs(): HTMLElement[] {
  return screen.getAllByRole("tab");
}

function selectedTab(): string | undefined {
  return tabs().find((tab) => tab.getAttribute("aria-selected") === "true")
    ?.textContent;
}

describe("the tab bar", () => {
  it("offers the five panes in order and opens the one pressed", () => {
    const { store, ui } = mount(
      <>
        <TabBar />
        <TabPanel tab="note" keepMounted>
          note body
        </TabPanel>
        <TabPanel tab="properties">properties rows</TabPanel>
      </>,
    );
    render(ui);

    expect(tabs().map((tab) => tab.textContent)).toEqual([
      m.workbench_tab_note(),
      m.workbench_tab_properties(),
      m.workbench_tab_annotation(),
      m.workbench_tab_match(),
      m.workbench_tab_name_and_folder(),
    ]);
    expect(selectedTab()).toBe(m.workbench_tab_note());
    expect(screen.getByRole("tabpanel")).toHaveProperty(
      "textContent",
      "note body",
    );
    expect(screen.queryByText("properties rows")).toBeNull();

    fireEvent.click(
      screen.getByRole("tab", { name: m.workbench_tab_properties() }),
    );

    expect(store.getState().tab).toBe("properties");
    expect(selectedTab()).toBe(m.workbench_tab_properties());
    // The note pane stays in the page, hidden, so its editor keeps its state.
    const note = screen.getByText("note body");
    expect(note.hidden).toBe(true);
    expect(note.dataset.state).toBe("inactive");
    expect(screen.getByRole("tabpanel").textContent).toBe("properties rows");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(
      screen.getByRole("tab", { name: m.workbench_tab_properties() }).id,
    );
  });

  it("follows the store and moves through the tabs from the keyboard", () => {
    const { store, ui } = mount(<TabBar />);
    render(ui);
    act(() => store.getState().setTab("annotation"));
    expect(selectedTab()).toBe(m.workbench_tab_annotation());

    const list = screen.getByRole("tablist");
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(store.getState().tab).toBe("match");
    expect(document.activeElement?.textContent).toBe(m.workbench_tab_match());
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(store.getState().tab).toBe("name");
    expect(document.activeElement?.textContent).toBe(
      m.workbench_tab_name_and_folder(),
    );
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(store.getState().tab).toBe("note");
    fireEvent.keyDown(list, { key: "ArrowLeft" });
    expect(store.getState().tab).toBe("name");
    fireEvent.keyDown(list, { key: "Home" });
    expect(store.getState().tab).toBe("note");
    fireEvent.keyDown(list, { key: "End" });
    expect(store.getState().tab).toBe("name");
    // Only the chosen tab is in the tab order.
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([-1, -1, -1, -1, 0]);
  });

  it("marks its parts and wears the host's classes, nothing more", () => {
    const { ui } = mount(<TabBar />);
    render(ui);
    const list = screen.getByRole("tablist");
    expect(list.dataset.part).toBe("tab-bar");
    expect(list.className).toBe("part-tab-bar");
    for (const tab of tabs()) {
      expect(tab.dataset.part).toBe("tab");
      expect(tab.className).toBe("part-tab");
    }
    expect(tabs().map((tab) => tab.dataset.state)).toEqual([
      "active",
      "inactive",
      "inactive",
      "inactive",
      "inactive",
    ]);
  });

  it("runs host navigation effects only for user tab and mode actions", () => {
    const onTabChange = vi.fn<(tab: string) => void>();
    const onModeChange = vi.fn<(advanced: boolean) => void>();
    const { store, ui } = mount(
      <>
        <TabBar onTabChange={onTabChange} />
        <EditToolbar onModeChange={onModeChange} />
      </>,
    );
    render(ui);
    act(() => {
      store.getState().setTab("properties");
      store.getState().setAdvanced(true);
    });
    expect(onTabChange).not.toHaveBeenCalled();
    expect(onModeChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: m.workbench_tab_note() }));
    expect(onTabChange).toHaveBeenLastCalledWith("note");
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "End" });
    expect(onTabChange).toHaveBeenLastCalledWith("name");
    const basic = screen.getByRole("button", { name: m.workbench_basic() });
    fireEvent.click(basic);
    fireEvent.click(basic);
    expect(onModeChange.mock.calls).toEqual([[false], [false]]);
  });

  it("paints inert outside an editor", () => {
    render(
      <>
        <TabBar />
        <TabPanel tab="note">quiet</TabPanel>
      </>,
    );
    for (const tab of tabs()) {
      expect(tab.getAttribute("aria-disabled")).toBe("true");
      expect((tab as HTMLButtonElement).disabled).toBe(true);
    }
    expect(tabs()[0]?.className).toBe("");
    expect(screen.getByRole("tabpanel").textContent).toBe("quiet");
  });
});

describe("the edit toolbar", () => {
  it("puts shared history and an Advanced toggle between the host's header slots", () => {
    const onModeChange = vi.fn<(advanced: boolean) => void>();
    const { store, ui } = mount(
      <EditToolbar
        layout="linear"
        leading={<button>Paper</button>}
        onModeChange={onModeChange}
      >
        <button>Markdown</button>
        <button>Menu</button>
      </EditToolbar>,
    );
    render(ui);
    expect(
      screen
        .getAllByRole("button")
        .map(
          (button) => button.getAttribute("aria-label") ?? button.textContent,
        ),
    ).toEqual([
      "Paper",
      m.workbench_undo(),
      m.workbench_redo(),
      m.workbench_advanced(),
      "Markdown",
      "Menu",
    ]);
    const advanced = screen.getByRole("button", {
      name: m.workbench_advanced(),
    });
    fireEvent.click(advanced);
    expect(store.getState().advanced).toBe(true);
    fireEvent.click(advanced);
    expect(store.getState().advanced).toBe(false);
    expect(onModeChange.mock.calls).toEqual([[true], [false]]);
  });
  it("switches Basic and Advanced through the store", () => {
    const { store, ui } = mount(<EditToolbar />);
    render(ui);
    const basic = screen.getByRole("button", { name: m.workbench_basic() });
    const advanced = screen.getByRole("button", {
      name: m.workbench_advanced(),
    });
    expect(basic.getAttribute("aria-pressed")).toBe("true");
    expect(advanced.getAttribute("aria-pressed")).toBe("false");
    expect(basic.dataset.state).toBe("on");
    expect(basic.querySelector("[data-icon]")?.getAttribute("data-icon")).toBe(
      "basic",
    );

    fireEvent.click(advanced);
    expect(store.getState().advanced).toBe(true);
    expect(advanced.getAttribute("aria-pressed")).toBe("true");
    expect(basic.dataset.state).toBe("off");

    act(() => store.getState().setAdvanced(false));
    expect(basic.getAttribute("aria-pressed")).toBe("true");
  });

  it("undoes and redoes the document's one history", () => {
    const { controller, ui } = mount(<EditToolbar />);
    render(ui);
    const undo = screen.getByRole("button", { name: m.workbench_undo() });
    const redo = screen.getByRole("button", { name: m.workbench_redo() });
    expect((undo as HTMLButtonElement).disabled).toBe(true);
    expect((redo as HTMLButtonElement).disabled).toBe(true);
    // The host's tooltip attributes, beside the label.
    expect(undo.getAttribute("aria-description")).toBe(m.workbench_undo());
    expect(undo.className).toBe("part-undo");

    act(() =>
      controller.dispatch({
        changes: { from: 0, to: 0, insert: "# " },
        userEvent: "input.type",
      }),
    );
    expect((undo as HTMLButtonElement).disabled).toBe(false);
    expect(controller.source.startsWith("# ")).toBe(true);

    fireEvent.click(undo);
    expect(controller.source).toBe(DEFAULT_PROFILE_SOURCE);
    expect((redo as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(redo);
    expect(controller.source.startsWith("# ")).toBe(true);
  });

  it("carries the host's own controls and paints inert outside an editor", () => {
    render(
      <EditToolbar>
        <button type="button">Add a field</button>
      </EditToolbar>,
    );
    for (const button of screen.getAllByRole("button")) {
      expect((button as HTMLButtonElement).disabled).toBe(
        button.textContent !== "Add a field",
      );
    }
    expect(screen.getByRole("button", { name: m.workbench_undo() }).title).toBe(
      m.workbench_undo(),
    );
  });
});

describe("the Problems footer", () => {
  it("names the problem, the recovery, and the pane it is repaired in", () => {
    const controller = new WorkbenchDocumentController(
      DEFAULT_PROFILE_SOURCE.replace("language: liquid", "language: eta"),
    );
    const opened: string[] = [];
    const { ui } = mount(
      <ProblemsFooter
        problem={controller.problems[0]!}
        onOpen={(problem) => opened.push(problem.code)}
      />,
    );
    render(ui);

    const footer = screen.getByRole("region", {
      name: m.workbench_problems_heading(),
    });
    expect(footer.className).toBe("part-problems");
    expect(footer.textContent).toContain(
      m.workbench_problem_unsupported_language(),
    );
    expect(footer.textContent).toContain(
      m.workbench_problem_unsupported_recovery(),
    );
    const open = screen.getByRole("button", {
      name: m.workbench_problems_where_advanced(),
    });
    fireEvent.click(open);
    expect(opened).toEqual(["unsupported-language"]);
  });

  it("points a row problem at its entry and a section problem at the Annotation tab", () => {
    const { ui } = mount(
      <>
        <ProblemsFooter
          problem={{ code: "invalid-document", slice: "entry:2" }}
          onOpen={() => {}}
        />
        <ProblemsFooter
          problem={{ code: "missing-annotation-section", slice: "note" }}
          onOpen={() => {}}
        />
        <ProblemsFooter problem={null} onOpen={() => {}} />
      </>,
    );
    render(ui);
    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual([
      m.workbench_problems_where_entry(),
      m.workbench_annotation_label(),
    ]);
    expect(screen.getAllByRole("region")).toHaveLength(2);
  });
});

describe("the view store", () => {
  it("starts on the Note tab in Basic mode with the Simple Explorer", () => {
    const store = createWorkbenchStore();
    expect(store.getState()).toMatchObject({
      tab: "note",
      item: null,
      root: "note",
      preview: { mode: "create", live: true },
      explorer: "simple",
      advanced: false,
      startHereDismissed: false,
    });
  });

  it("takes a host's starting state and changes one field at a time", () => {
    const store = createWorkbenchStore({ explorer: "all", tab: "name" });
    const { setItem, setRoot, setPreview, dismissStartHere } = store.getState();
    setItem({ id: "ABCD1234", title: "A paper" });
    setRoot("filename");
    setPreview({ live: false });
    dismissStartHere();
    expect(store.getState()).toMatchObject({
      tab: "name",
      explorer: "all",
      item: { id: "ABCD1234", title: "A paper" },
      root: "filename",
      preview: { mode: "create", live: false },
      startHereDismissed: true,
    });
  });
});
