import type { WorkbenchProblem } from "#/document/controller";
import type { RenderDiagnostic } from "#/render/result";
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
  onReturn,
  onAction,
  open,
}: {
  diagnoses: readonly WorkbenchDiagnosis[];
  onOpen: (diagnosis: WorkbenchDiagnosis) => void;
  onReturn?: () => void;
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
    <ProblemsFooter
      problems={problems}
      onOpen={onOpen}
      onReturn={onReturn}
      onAction={onAction}
    />
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

/** The controls that decide how much editor a reading takes, which every
    open area carries whatever problem it explains. */
const SPACE_CONTROLS = new Set([
  m.workbench_problems_expand(),
  m.workbench_problems_collapse(),
  m.workbench_problems_return(),
]);

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
        .filter((label) => !SPACE_CONTROLS.has(label ?? "")),
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
        .filter((label) => !SPACE_CONTROLS.has(label ?? "")),
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

  it("reads repeated occurrences as one problem and equal words at two targets as two", () => {
    // One style the citation engine refused, reported by the note's own
    // citations and again by the annotation's: one cause, one repair target,
    // one explanation, and the place each occurrence was reported from.
    const styleFailure = {
      code: "citation-style-error",
      params: { styleId: "numeric" },
      message: "The citation style could not be used.",
      part: "render",
    } as const;
    // Two entries failing in the very same words are two problems: the words
    // establish nothing, and each entry is repaired on its own row.
    const property = (position: number, key: string) =>
      ({
        code: "property-error",
        params: { key },
        message: "Cannot read properties of undefined",
        part: "properties",
        position,
      }) as const;
    using mounted = mount(
      <Problems
        diagnoses={workbenchDiagnoses(
          [],
          [
            { ...styleFailure, engine: { template: "paper:body", line: 3 } },
            {
              ...styleFailure,
              engine: { template: "paper:annotation", line: 2 },
            },
            property(1, "title"),
            property(2, "tags"),
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
    expect(area.textContent).toContain(
      m.workbench_problems_count({ count: 3 }),
    );
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual([
      m.workbench_problems_object_style({ styleId: "numeric" }),
      m.workbench_problems_object_property({ key: "title" }),
      m.workbench_problems_object_property({ key: "tags" }),
    ]);
    // The grouped occurrences keep the places they were each reported from.
    expect(area.textContent).toContain(
      m.workbench_problems_engine_source_line({
        template: "paper:body",
        line: 3,
      }),
    );
    expect(area.textContent).toContain(
      m.workbench_problems_engine_source_line({
        template: "paper:annotation",
        line: 2,
      }),
    );
  });

  it("holds the selected problem through a check and offers Next problem once it goes", () => {
    const remaining = {
      code: "render-error",
      message: "Later",
      part: "render",
    } as const;
    function Harness(): ReactNode {
      const [repaired, setRepaired] = useState(false);
      const problems = useWorkbenchProblems({
        diagnoses: workbenchDiagnoses(
          [],
          repaired
            ? [remaining]
            : [{ code: "render-error", message: "First" }, remaining],
        ),
        trigger: "automatic",
        attempt: 1,
      });
      const { setOpen } = problems;
      useEffect(() => {
        setOpen(true);
      }, [setOpen]);
      return (
        <>
          <button type="button" onClick={() => setRepaired(true)}>
            repair
          </button>
          <ProblemsFooter problems={problems} onOpen={() => {}} />
        </>
      );
    }
    using mounted = mount(<Harness />);
    const { ui } = mounted;
    render(ui);
    const area = screen.getByRole("region", {
      name: m.workbench_problems_heading(),
    });
    expect(area.textContent).toContain(
      m.workbench_problems_count({ count: 2 }),
    );
    expect(area.textContent).toContain("First");

    fireEvent.click(screen.getByText("repair"));
    // The repaired problem is reported as gone and the remaining one is
    // offered, so nothing reads as success and nothing moves on its own.
    expect(area.textContent).toContain(m.workbench_problems_resolved());
    expect(area.textContent).not.toContain(m.workbench_problems_none());
    expect(area.textContent).toContain(
      m.workbench_problems_count({ count: 1 }),
    );
    expect(area.textContent).not.toContain("Later");

    fireEvent.click(
      screen.getByRole("button", { name: m.workbench_problems_next() }),
    );
    expect(area.textContent).toContain("Later");
    expect(area.textContent).not.toContain(m.workbench_problems_resolved());
  });

  it("hands the editor over on Expand and takes the reader back to the source", () => {
    let returned = 0;
    using mounted = mount(
      <Problems
        diagnoses={workbenchDiagnoses(
          [],
          [{ code: "render-error", message: "Unclosed tag" }],
        )}
        onOpen={() => {}}
        onReturn={() => (returned += 1)}
        open
      />,
    );
    const { ui } = mounted;
    render(ui);
    const area = screen.getByRole("region", {
      name: m.workbench_problems_heading(),
    });
    expect(area.dataset.state).toBe("open");

    // What scrolls is the explanation; every control that navigates or reports
    // is under it, where a long explanation cannot carry them out of reach.
    const scroll = area.querySelector("[data-part=problems-scroll]");
    const controls = area.querySelector("[data-part=problems-controls]");
    expect(scroll?.contains(controls ?? null)).toBe(false);
    expect(scroll?.querySelector("details")).not.toBeNull();
    for (const label of [
      m.workbench_problems_where_advanced(),
      m.workbench_problems_return(),
      m.workbench_problems_community(),
    ])
      expect(
        controls?.contains(screen.getByText(label)),
        `${label} is under the scroll`,
      ).toBe(true);

    fireEvent.click(
      screen.getByRole("button", { name: m.workbench_problems_expand() }),
    );
    expect(area.dataset.state).toBe("full");
    // Nothing left to expand into, so the control that asked for it goes.
    expect(
      screen.queryByRole("button", { name: m.workbench_problems_expand() }),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: m.workbench_problems_return() }),
    );
    expect(returned).toBe(1);
    expect(area.dataset.state).toBe("compact");
    // The next reading starts from the split, not from the space the last took.
    fireEvent.click(
      screen.getByRole("button", { name: m.workbench_problem_show() }),
    );
    expect(area.dataset.state).toBe("open");
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

/**
 * One failed attempt, written out by hand: a multiline engine message, the
 * chain behind it, a caret excerpt whose columns only mean anything intact,
 * and a stack. The area has to show and copy exactly this and nothing else.
 */
const CAPTURED: RenderDiagnostic = {
  code: "missing-partial",
  params: { name: "book-details" },
  part: "render",
  evidence: {
    message: 'Template "book-details" not found\n  while rendering note',
    name: "MissingTemplateError",
    stack:
      'MissingTemplateError: Template "book-details" not found\n    at renderByName',
    causes: ["Could not find template: book-details"],
    context: '1| {% render "book-details" %}\n            ^^^^^^^^^^^^^',
    reportedLocation: "book-details:1",
  },
  report: {
    code: "missing-partial",
    evidence: {
      message: 'Template "book-details" not found\n  while rendering note',
      name: "MissingTemplateError",
      stack:
        'MissingTemplateError: Template "book-details" not found\n    at renderByName',
      causes: ["Could not find template: book-details"],
      context: '1| {% render "book-details" %}\n            ^^^^^^^^^^^^^',
      reportedLocation: "book-details:1",
    },
    section: "render",
    capturedAt: "2026-09-13T10:00:00Z",
    trigger: "automatic",
    sequence: 3,
    identity: {
      previewMode: "create",
      sourceRevision: "1a2b3c4d",
      snapshotRevision: "r7",
      annotationId: "ANNO2345",
      annotationRevision: "r2",
    },
    context: {
      document: "templates/paper.md",
      language: "liquid",
      root: "note",
      selection: "MAIN2345",
      zotlitVersion: "2.1.0",
      hostVersion: "Obsidian 1.9.0",
    },
  },
};

/** The whole report, derived by hand from the attempt above. */
const CAPTURED_TEXT = [
  "ZotLit template error report",
  "",
  "Engine message:",
  'Template "book-details" not found',
  "  while rendering note",
  "",
  "Problem code: missing-partial",
  "Engine name: MissingTemplateError",
  "Reported location: book-details:1",
  "Engine location: unavailable",
  "Calling template: unavailable",
  "Repair target: unavailable",
  "Document section: render",
  "",
  "Cause:",
  "Could not find template: book-details",
  "",
  "Source excerpt:",
  '1| {% render "book-details" %}',
  "            ^^^^^^^^^^^^^",
  "",
  "Stack:",
  'MissingTemplateError: Template "book-details" not found',
  "    at renderByName",
  "",
  "Captured at: 2026-09-13T10:00:00Z",
  "Trigger: automatic",
  "Attempt: 3",
  "Template document: templates/paper.md",
  "Template language: liquid",
  "Rendering root: note",
  "Render options: mode=create",
  "Selection: item=MAIN2345, annotation=ANNO2345@r2",
  "Source revision: 1a2b3c4d",
  "Snapshot revision: r7",
  "ZotLit version: 2.1.0",
  "Host version: Obsidian 1.9.0",
  "Engine version: unavailable",
].join("\n");

function reportBlock(): HTMLElement {
  return screen
    .getByRole("region", {
      name: m.workbench_problems_heading(),
    })
    .querySelector<HTMLElement>('[data-part="problems-report"]')!;
}

describe("the error report", () => {
  it("shows the text it copies, and marks what the attempt could not supply", () => {
    using mounted = mount(
      <Problems
        diagnoses={workbenchDiagnoses([], [CAPTURED])}
        onOpen={() => {}}
        open
      />,
    );
    const { ui, host } = mounted;
    render(ui);

    expect(reportBlock().textContent).toBe(CAPTURED_TEXT);
    // Nothing establishes where the failure belongs yet, and the report says
    // so rather than leaving three blanks a reader would read as "none".
    expect(reportBlock().textContent).toContain("Engine location: unavailable");
    expect(
      screen.getByText(m.workbench_problems_technical()).closest("details")
        ?.open,
    ).toBe(false);

    fireEvent.click(
      screen.getByRole("button", { name: m.workbench_problems_copy() }),
    );
    expect(host.calls.copies).toEqual([CAPTURED_TEXT]);
    expect(
      screen.getByRole("link", { name: m.workbench_problems_community() }),
    ).toHaveProperty("href", "https://example.invalid/community");
  });

  it("leaves the report readable when the clipboard refuses it", async () => {
    using mounted = mount(
      <Problems
        diagnoses={workbenchDiagnoses([], [CAPTURED])}
        onOpen={() => {}}
        open
      />,
    );
    const { ui, host } = mounted;
    host.copyFails = true;
    render(ui);

    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: m.workbench_problems_copy() }),
      ),
    );
    expect(screen.getByRole("alert").textContent).toBe(
      m.workbench_problems_copy_failed(),
    );
    // The disclosure opens itself, so the text the clipboard refused is there
    // to select and copy by hand.
    expect(
      screen.getByText(m.workbench_problems_technical()).closest("details")
        ?.open,
    ).toBe(true);
    expect(reportBlock().textContent).toBe(CAPTURED_TEXT);
    expect(host.calls.notices).toEqual([]);
  });

  it("keeps the inspected report after the repair that resolves it", async () => {
    function Harness(): ReactNode {
      const [failing, setFailing] = useState(true);
      const problems = useWorkbenchProblems({
        diagnoses: failing ? workbenchDiagnoses([], [CAPTURED]) : [],
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
    const { ui, host } = mounted;
    render(ui);
    expect(
      screen.getByRole("button", { name: m.workbench_problems_copy() }),
    ).toBeDefined();

    await act(async () => fireEvent.click(screen.getByText("repair")));
    expect(screen.getByText(m.workbench_problems_none())).toBeDefined();
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: m.workbench_problems_copy_last() }),
      ),
    );
    // The repair changed the document, not the failure that was reported.
    expect(host.calls.copies).toEqual([CAPTURED_TEXT]);
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
