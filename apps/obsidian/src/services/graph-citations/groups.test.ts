// @vitest-environment happy-dom
import type { GraphColor, GraphEngine, GraphOptions } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";

import {
  addLiteratureNotesGroup,
  DEFAULT_COLOR,
  groupsTarget,
  installGroupsButton,
} from "./groups";
import { GraphNodeColors } from "./node-color";
import { FakeColorGroupSection } from "./test-double";
import { themeStates, themeStatesNothing } from "./test-stub";

const warn = vi.hoisted(() => vi.fn());
vi.mock("@/lib/log", () => ({
  getLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn,
  }),
}));

/** A red the theme can be made to state, to tell a themed colour from the fallback. */
const RED: GraphColor = { a: 1, rgb: 0xff0000 };

const OTHER_GROUP = { query: "tag:#paper", color: { a: 1, rgb: 0x00ff00 } };

afterEach(() => {
  themeStatesNothing();
});

function fixture() {
  const section = new FakeColorGroupSection();
  section.setColorQueries([]);
  const setOptions = vi.fn((options: GraphOptions) => {
    const groups = options.colorGroups;
    if (Array.isArray(groups)) section.setColorQueries(groups);
  });
  const engine = {
    colorGroupOptions: section,
    setOptions,
  } as unknown as GraphEngine;
  return {
    engine,
    section,
    setOptions,
    /** ZotLit's button: the one in the last container, below the native control. */
    button: () =>
      section.childrenEl.querySelector<HTMLButtonElement>(
        ".graph-color-button-container:last-child button",
      )!,
  };
}

describe("installGroupsButton", () => {
  it("builds the button below the native New group control, in native style", () => {
    const { engine, section } = fixture();

    using _button = installGroupsButton(engine, new GraphNodeColors());

    const containers = [...section.childrenEl.children].map(
      (el) => el.className,
    );
    expect(containers).toEqual([
      "graph-color-groups-container",
      "graph-color-button-container",
      "graph-color-button-container",
    ]);
    expect(section.childrenEl.lastElementChild!.textContent).toBe(
      m.graph_citations_add_literature_notes_group(),
    );
  });

  it("adds one literature notes group, through the engine's set-options path", () => {
    const { engine, section, button, setOptions } = fixture();
    using _button = installGroupsButton(engine, new GraphNodeColors());

    button().click();

    expect(setOptions).toHaveBeenCalledWith({
      colorGroups: [{ query: '["zotero-key"]', color: DEFAULT_COLOR }],
    });
    expect(section.getColoredQueries()).toEqual([
      { query: '["zotero-key"]', color: DEFAULT_COLOR },
    ]);
  });

  it("does nothing on a second press, and leaves the groups the user has", () => {
    const { engine, section, button, setOptions } = fixture();
    section.setColorQueries([OTHER_GROUP]);
    using _button = installGroupsButton(engine, new GraphNodeColors());
    button().click();
    const added = section.getColoredQueries();

    button().click();

    expect(setOptions).toHaveBeenCalledOnce();
    expect(section.getColoredQueries()).toEqual(added);
    expect(added).toEqual([
      OTHER_GROUP,
      { query: '["zotero-key"]', color: DEFAULT_COLOR },
    ]);
  });

  it("starts the group at the colour the theme states for a literature note", () => {
    themeStates("rgb(255, 0, 0)", "rgb(0, 0, 255)");
    const { engine, section, button } = fixture();
    using _button = installGroupsButton(engine, new GraphNodeColors());

    button().click();

    expect(section.getColoredQueries()).toEqual([
      { query: '["zotero-key"]', color: RED },
    ]);
  });

  it("stays in the section as a reorder or a restore builds the body again", () => {
    const { engine, section, button } = fixture();
    using _button = installGroupsButton(engine, new GraphNodeColors());

    // What the option listener, a drag-reorder, and "Restore default settings"
    // run through.
    section.setColorQueries([OTHER_GROUP]);
    section.setColorQueries([]);

    expect(section.childrenEl.lastElementChild!.textContent).toBe(
      m.graph_citations_add_literature_notes_group(),
    );
    expect(
      section.childrenEl.querySelectorAll(".graph-color-button-container"),
    ).toHaveLength(2);
    button().click();
    expect(section.getColoredQueries()).toEqual([
      { query: '["zotero-key"]', color: DEFAULT_COLOR },
    ]);
  });

  it("stays in the section as the native New group and delete mutate the rows", () => {
    const { engine, section } = fixture();
    using _button = installGroupsButton(engine, new GraphNodeColors());
    const rows = section.childrenEl.querySelector<HTMLElement>(
      ".graph-color-groups-container",
    )!;

    // What the native "New group" and the per-row delete do: build a row into
    // the rows container, and take one away again, with no rebuild.
    const row = rows.createDiv("graph-color-group");
    row.remove();

    expect(section.childrenEl.lastElementChild!.textContent).toBe(
      m.graph_citations_add_literature_notes_group(),
    );
  });

  it("leaves the section as found on disposal", () => {
    const { engine, section } = fixture();
    const restore = installGroupsButton(engine, new GraphNodeColors());

    restore[Symbol.dispose]();

    expect(
      section.childrenEl.querySelectorAll(".graph-color-button-container"),
    ).toHaveLength(1);
    expect(Object.hasOwn(section, "setColorQueries")).toBe(false);
    section.setColorQueries([]);
    expect(
      section.childrenEl.querySelectorAll(".graph-color-button-container"),
    ).toHaveLength(1);
  });

  it("builds no button and reports once when the build moved a member", () => {
    const engine = { colorGroupOptions: {} } as GraphEngine;

    using _first = installGroupsButton(engine, new GraphNodeColors());
    using _second = installGroupsButton(engine, new GraphNodeColors());

    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("addLiteratureNotesGroup", () => {
  it("reports whether it added a group", () => {
    const { engine } = fixture();
    const target = groupsTarget(engine)!;

    expect(addLiteratureNotesGroup(target, DEFAULT_COLOR)).toBe(true);
    expect(addLiteratureNotesGroup(target, DEFAULT_COLOR)).toBe(false);
  });
});
