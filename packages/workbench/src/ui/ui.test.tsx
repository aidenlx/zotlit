import type { WorkbenchProblem } from "#/document/controller";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EditToolbar } from "./edit-toolbar";
import type { WorkbenchDiagnosis } from "./problems";
import { workbenchDiagnoses } from "./problems";
import { ProblemsFooter, useWorkbenchProblems } from "./problems-footer";
import type { RenderTrigger } from "./scheduler";
import { createWorkbenchStore } from "./store";
import { TabBar, TabPanel } from "./tab-bar";
import { mount, renderWithMessages as render } from "./test-host";
import { m } from "./test-messages";

import { WorkbenchDocumentController } from "#/document/controller";
import { DEFAULT_PROFILE_SOURCE } from "#/render/default-profile";

afterEach(cleanup);

/**
 * The Problems area with its own state, as a host composes it. `open` reads
 * the area the way a reader who asked for the explanation sees it.
 */
function Problems({
  diagnoses,
  onOpen,
  onAction,
  open,
}: {
  diagnoses: readonly WorkbenchDiagnosis[];
  onOpen: (diagnosis: WorkbenchDiagnosis) => void;
  onAction?: (problem: WorkbenchProblem) => void;
  open?: boolean;
}): ReactNode {
  const problems = useWorkbenchProblems({
    diagnoses,
    trigger: "automatic",
    attempt: 1,
  });
  const { setOpen } = problems;
  useEffect(() => {
    if (open === true) setOpen(true);
  }, [open, setOpen]);
  return (
    <ProblemsFooter problems={problems} onOpen={onOpen} onAction={onAction} />
  );
}

function tabs(): HTMLElement[] {
  return screen.getAllByRole("tab");
}

function selectedTab(): string | undefined {
  return tabs().find((tab) => tab.getAttribute("aria-selected") === "true")
    ?.textContent;
}

describe("the tab bar", () => {
  it("offers the six panes in order and opens the one pressed", () => {
    using mounted = mount(
      <>
        <TabBar />
        <TabPanel tab="note" keepMounted description={false}>
          note body
        </TabPanel>
        <TabPanel tab="properties" description={false}>
          properties rows
        </TabPanel>
      </>,
    );
    const { store, ui } = mounted;
    render(ui);

    expect(tabs().map((tab) => tab.textContent)).toEqual([
      m.workbench_tab_note(),
      m.workbench_tab_properties(),
      m.workbench_tab_annotation(),
      m.workbench_tab_name_and_folder(),
      m.workbench_tab_match(),
      m.workbench_tab_profile(),
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
    using mounted = mount(<TabBar />, {
      source: DEFAULT_PROFILE_SOURCE.replace("id: default", "id: reading"),
    });
    const { store, ui } = mounted;
    render(ui);
    act(() => store.getState().setTab("annotation"));
    expect(selectedTab()).toBe(m.workbench_tab_annotation());

    const list = screen.getByRole("tablist");
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(store.getState().tab).toBe("name");
    expect(document.activeElement?.textContent).toBe(
      m.workbench_tab_name_and_folder(),
    );
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(store.getState().tab).toBe("match");
    expect(document.activeElement?.textContent).toBe(m.workbench_tab_match());
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(store.getState().tab).toBe("profile");
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(store.getState().tab).toBe("note");
    fireEvent.keyDown(list, { key: "ArrowLeft" });
    expect(store.getState().tab).toBe("profile");
    fireEvent.keyDown(list, { key: "Home" });
    expect(store.getState().tab).toBe("note");
    fireEvent.keyDown(list, { key: "End" });
    expect(store.getState().tab).toBe("profile");
    // Only the chosen tab is in the tab order.
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([-1, -1, -1, -1, -1, 0]);
  });

  it("keeps Default Match disabled and skips it during traversal and restoration", () => {
    using mounted = mount(
      <>
        <TabBar />
        <TabPanel tab="match">match rules</TabPanel>
      </>,
      { state: { tab: "match" } },
    );
    const { store, ui } = mounted;
    expect(store.getState().tab).toBe("note");
    render(ui);
    const match = screen.getByRole("tab", { name: m.workbench_tab_match() });
    expect(match).toHaveProperty("disabled", true);
    fireEvent.click(match);
    expect(store.getState().tab).toBe("note");
    act(() => store.getState().setTab("annotation"));
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(store.getState().tab).toBe("name");
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowLeft" });
    expect(store.getState().tab).toBe("annotation");
    act(() => store.getState().setTab("match"));
    expect(store.getState().tab).toBe("note");
    expect(screen.queryByText("match rules")).toBeNull();
    act(() =>
      mounted.controller.dispatch({
        changes: {
          from: 0,
          to: mounted.controller.source.length,
          insert: "---\nid: [",
        },
      }),
    );
    expect(mounted.controller.document).toBeNull();
    expect(match).toHaveProperty("disabled", true);
    act(() => store.getState().setTab("match"));
    expect(store.getState().tab).toBe("note");
  });

  it("uses the host's Default identity when the first source cannot parse", () => {
    using mounted = mount(<TabBar defaultProfile />, {
      source: "---\nid: [",
      state: { tab: "match" },
    });
    render(mounted.ui);
    expect(
      screen.getByRole("tab", { name: m.workbench_tab_match() }),
    ).toHaveProperty("disabled", true);
    expect(mounted.store.getState().tab).toBe("note");
  });

  it("marks its parts and wears the host's classes, nothing more", () => {
    using mounted = mount(<TabBar />);
    const { ui } = mounted;
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
      "inactive",
    ]);
  });

  it("runs host navigation effects only for user tab and mode actions", () => {
    const onTabChange = vi.fn<(tab: string) => void>();
    const onModeChange = vi.fn<(advanced: boolean) => void>();
    using mounted = mount(
      <>
        <TabBar onTabChange={onTabChange} />
        <EditToolbar onModeChange={onModeChange} />
      </>,
    );
    const { store, ui } = mounted;
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
    expect(onTabChange).toHaveBeenLastCalledWith("profile");
    const basic = screen.getByRole("button", { name: m.workbench_basic() });
    fireEvent.click(basic);
    fireEvent.click(basic);
    expect(onModeChange.mock.calls).toEqual([[false], [false]]);
  });

  it("paints inert outside an editor", () => {
    render(
      <>
        <TabBar />
        <TabPanel tab="note" description={false}>
          quiet
        </TabPanel>
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
    using mounted = mount(
      <EditToolbar
        layout="linear"
        leading={<button>Paper</button>}
        onModeChange={onModeChange}
      >
        <button>Markdown</button>
        <button>Menu</button>
      </EditToolbar>,
    );
    const { store, ui } = mounted;
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
    using mounted = mount(<EditToolbar />);
    const { store, ui } = mounted;
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
    using mounted = mount(<EditToolbar />);
    const { controller, ui } = mounted;
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

describe("the Problems area", () => {
  it("starts compact, then explains the selected problem in full", () => {
    const controller = new WorkbenchDocumentController(
      DEFAULT_PROFILE_SOURCE.replace("language: liquid", "language: eta"),
    );
    const opened: string[] = [];
    using mounted = mount(
      <Problems
        diagnoses={workbenchDiagnoses(controller.problems, [])}
        onOpen={(diagnosis) =>
          opened.push(
            diagnosis.kind === "document"
              ? diagnosis.problem.code
              : diagnosis.diagnostic.code,
          )
        }
      />,
    );
    const { ui } = mounted;
    render(ui);

    const area = screen.getByRole("region", {
      name: m.workbench_problems_heading(),
    });
    expect(area.className).toBe("part-problems");
    expect(area.textContent).toContain(
      m.workbench_problem_unsupported_language(),
    );
    expect(area.textContent).not.toContain(
      m.workbench_problem_unsupported_recovery(),
    );

    fireEvent.click(
      screen.getByRole("button", { name: m.workbench_problem_show() }),
    );
    expect(area.textContent).toContain(m.workbench_advanced());
    expect(area.textContent).toContain(
      m.workbench_problem_unsupported_recovery(),
    );
    expect(
      screen.getByText(m.workbench_problems_technical()).closest("details")
        ?.open,
    ).toBe(false);
    fireEvent.click(
      screen.getByRole("button", {
        name: m.workbench_problems_where_advanced(),
      }),
    );
    expect(opened).toEqual(["unsupported-language"]);
  });

  it("offers the unpack button only to a host that can perform it", () => {
    const problem = {
      code: "bundled-partial",
      params: { names: "authors" },
      slice: "advanced",
    } as const;
    const unpacked: string[] = [];
    using mounted = mount(
      <>
        <Problems
          diagnoses={workbenchDiagnoses([problem], [])}
          onOpen={() => {}}
          onAction={(target) => unpacked.push(target.code)}
          open
        />
        <Problems
          diagnoses={workbenchDiagnoses([problem], [])}
          onOpen={() => {}}
          open
        />
      </>,
    );
    const { ui } = mounted;
    render(ui);

    expect(
      screen
        .getAllByRole("button")
        .map((button) => button.textContent)
        .filter((label) => label !== m.workbench_problems_collapse()),
    ).toEqual([
      m.workbench_problems_where_advanced(),
      m.workbench_problem_bundled_partial_unpack(),
      m.workbench_problems_where_advanced(),
    ]);
    fireEvent.click(
      screen.getByRole("button", {
        name: m.workbench_problem_bundled_partial_unpack(),
      }),
    );
    expect(unpacked).toEqual(["bundled-partial"]);
  });

  it("points a row problem at its entry and a section problem at the Annotation tab", () => {
    using mounted = mount(
      <>
        <Problems
          diagnoses={workbenchDiagnoses(
            [{ code: "invalid-document", slice: "entry:2" }],
            [],
          )}
          onOpen={() => {}}
          open
        />
        <Problems
          diagnoses={workbenchDiagnoses(
            [{ code: "missing-annotation-section", slice: "note" }],
            [],
          )}
          onOpen={() => {}}
          open
        />
        <Problems diagnoses={[]} onOpen={() => {}} />
      </>,
    );
    const { ui } = mounted;
    render(ui);
    expect(
      screen
        .getAllByRole("button")
        .map((button) => button.textContent)
        .filter((label) => label !== m.workbench_problems_collapse()),
    ).toEqual([
      m.workbench_problems_where_entry(),
      m.workbench_annotation_label(),
    ]);
    expect(screen.getAllByRole("region")).toHaveLength(2);
  });

  it("explains a render failure with its evidence, and says when no location was reported", () => {
    using mounted = mount(
      <Problems
        diagnoses={workbenchDiagnoses(
          [],
          [
            {
              code: "render-error",
              message: "Unclosed tag on line 3",
              part: "render",
            },
          ],
        )}
        onOpen={() => {}}
        open
      />,
    );
    const { ui } = mounted;
    render(ui);
    const area = screen.getByRole("region", {
      name: m.workbench_problems_heading(),
    });
    expect(area.textContent).toContain("Unclosed tag on line 3");
    expect(area.textContent).toContain(
      m.workbench_diagnostic_render_error_suggestion(),
    );
    expect(area.textContent).toContain(m.workbench_problems_location_unknown());
  });

  it("keeps an open area after a check finds nothing, and gives its space back on Collapse", () => {
    function Harness(): ReactNode {
      const [failing, setFailing] = useState(true);
      const problems = useWorkbenchProblems({
        diagnoses: failing
          ? workbenchDiagnoses([], [{ code: "render-error", message: "Late" }])
          : [],
        trigger: "automatic",
        attempt: 1,
      });
      const { setOpen } = problems;
      useEffect(() => {
        setOpen(true);
      }, [setOpen]);
      return (
        <>
          <button type="button" onClick={() => setFailing(false)}>
            repair
          </button>
          <ProblemsFooter problems={problems} onOpen={() => {}} />
        </>
      );
    }
    using mounted = mount(<Harness />);
    const { ui } = mounted;
    render(ui);
    expect(screen.getAllByText("Late")).toHaveLength(2);

    fireEvent.click(screen.getByText("repair"));
    expect(screen.getByText(m.workbench_problems_none())).toBeDefined();

    fireEvent.click(
      screen.getByRole("button", { name: m.workbench_problems_collapse() }),
    );
    expect(
      screen.queryByRole("region", { name: m.workbench_problems_heading() }),
    ).toBeNull();
  });

  it("keeps the reader's choice through an automatic check and opens on a failed Run", () => {
    const diagnoses = workbenchDiagnoses(
      [],
      [{ code: "render-error", message: "Unclosed tag", part: "render" }],
    );
    function Harness(): ReactNode {
      const [attempt, setAttempt] = useState({
        trigger: "automatic" as RenderTrigger,
        count: 1,
      });
      const problems = useWorkbenchProblems({
        diagnoses,
        trigger: attempt.trigger,
        attempt: attempt.count,
      });
      return (
        <>
          <button
            type="button"
            onClick={() =>
              setAttempt(({ count }) => ({
                trigger: "automatic",
                count: count + 1,
              }))
            }
          >
            check
          </button>
          <button
            type="button"
            onClick={() =>
              setAttempt(({ count }) => ({
                trigger: "explicit",
                count: count + 1,
              }))
            }
          >
            run
          </button>
          <ProblemsFooter problems={problems} onOpen={() => {}} />
        </>
      );
    }
    using mounted = mount(<Harness />);
    const { ui } = mounted;
    render(ui);
    const shown = () =>
      screen.queryByText(m.workbench_diagnostic_render_error_suggestion()) !==
      null;
    expect(shown()).toBe(false);
    fireEvent.click(screen.getByText("check"));
    expect(shown()).toBe(false);
    fireEvent.click(screen.getByText("run"));
    expect(shown()).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: m.workbench_problems_collapse() }),
    );
    fireEvent.click(screen.getByText("check"));
    expect(shown()).toBe(false);
  });
});

describe("the view store", () => {
  it("starts on the Note tab in Basic mode", () => {
    const store = createWorkbenchStore();
    expect(store.getState()).toMatchObject({
      tab: "note",
      item: null,
      root: "note",
      advanced: false,
    });
  });

  it("takes a host's starting state and changes one field at a time", () => {
    const store = createWorkbenchStore({ tab: "name" });
    const { setItem, setRoot } = store.getState();
    setItem({ id: "ABCD1234", title: "A paper" });
    setRoot("filename");
    expect(store.getState()).toMatchObject({
      tab: "name",
      item: { id: "ABCD1234", title: "A paper" },
      root: "filename",
    });
  });
});
