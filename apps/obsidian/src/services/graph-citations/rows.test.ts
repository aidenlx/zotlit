import { settingsOf } from "@mock/obsidian";
import type { ToggleComponent } from "@mock/obsidian";
// @vitest-environment happy-dom
import type { GraphEngine, GraphOptions } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { installToggleRow, toggleRowTarget } from "./rows";
import type { ToggleRow, ToggleRowTarget } from "./rows";
import { FakeControlSection } from "./test-double";

const warn = vi.hoisted(() => vi.fn());
vi.mock("@/lib/log", () => ({
  getLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn,
  }),
}));

const ROW: ToggleRow = {
  key: "zotlit-pandoc-citations",
  name: "Pandoc citations",
  tooltip: "Draw an edge from each note to the works it cites.",
  defaultValue: true,
};

function fixture(
  options: { engine?: GraphOptions; saved?: GraphOptions } = {},
) {
  const section = new FakeControlSection();
  const engine = {
    options: options.engine ?? {},
    render: vi.fn(),
    onOptionsChange: vi.fn(),
  };
  const target: ToggleRowTarget = {
    engine,
    section,
    saved: options.saved ?? null,
  };
  return {
    target,
    engine,
    section,
    row: () => settingsOf(section.childrenEl)[0],
    toggle: () =>
      settingsOf(section.childrenEl)[0]!.components[0] as ToggleComponent,
  };
}

describe("installToggleRow", () => {
  it("builds a native-styled row at its default and writes that value to the engine", () => {
    const { target, engine, row, toggle } = fixture();

    using _row = installToggleRow(target, ROW);

    expect(row()).toMatchObject({
      name: "Pandoc citations",
      tooltip: ROW.tooltip,
      classes: ["mod-toggle"],
    });
    expect(toggle().getValue()).toBe(true);
    expect(engine.options).toEqual({ "zotlit-pandoc-citations": true });
    expect(engine.render).not.toHaveBeenCalled();
  });

  it("starts at the value the graph saved before the row existed", () => {
    const { target, engine, toggle } = fixture({
      saved: { "zotlit-pandoc-citations": false, showTags: true },
    });

    using _row = installToggleRow(target, ROW);

    expect(toggle().getValue()).toBe(false);
    expect(engine.options).toEqual({ "zotlit-pandoc-citations": false });
  });

  it("prefers the engine's live value, which a re-install finds where the user left it", () => {
    const { target, toggle } = fixture({
      engine: { "zotlit-pandoc-citations": false },
      saved: { "zotlit-pandoc-citations": true },
    });

    using _row = installToggleRow(target, ROW);

    expect(toggle().getValue()).toBe(false);
  });

  it("writes, re-renders, and saves when the user changes it", () => {
    const { target, engine, toggle } = fixture();
    using _row = installToggleRow(target, ROW);

    toggle().toggle(false);

    expect(engine.options["zotlit-pandoc-citations"]).toBe(false);
    expect(engine.render).toHaveBeenCalledOnce();
    expect(engine.onOptionsChange).toHaveBeenCalledOnce();
  });

  it("registers the listener the graph reads its value out of and writes it back through", () => {
    const { target, engine, section, toggle } = fixture();
    using _row = installToggleRow(target, ROW);
    // `engine.getOptions` enumerates `optionListeners` and calls each with no
    // argument; `engine.setOptions` calls the listener a passed key names.
    const listener = section.optionListeners["zotlit-pandoc-citations"];

    expect(listener?.()).toBe(true);
    listener?.(false);

    expect(toggle().getValue()).toBe(false);
    expect(engine.options["zotlit-pandoc-citations"]).toBe(false);
    expect(listener?.()).toBe(false);
  });

  it("returns to its default when the panel restores default settings", () => {
    const { target, engine, section, toggle } = fixture();
    using _row = installToggleRow(target, ROW);
    toggle().toggle(false);

    section.setDefaultOptions();

    expect(toggle().getValue()).toBe(true);
    expect(engine.options["zotlit-pandoc-citations"]).toBe(true);
    // The native keys still went through the native implementation.
    expect(section.natives).toBe(1);
    expect(engine.render).toHaveBeenCalledTimes(2);
  });

  it("leaves the section as found on disposal", () => {
    const { target, section, row } = fixture();
    const restore = installToggleRow(target, ROW);
    expect(row()).toBeDefined();

    restore[Symbol.dispose]();

    expect(settingsOf(section.childrenEl)).toEqual([]);
    expect(section.optionListeners).toEqual({});
    expect(Object.hasOwn(section, "setDefaultOptions")).toBe(false);
    section.setDefaultOptions();
    expect(section.natives).toBe(1);
  });
});

describe("toggleRowTarget", () => {
  it("reads the Filters section off the engine", () => {
    const section = new FakeControlSection();
    const engine = {
      options: {},
      render: vi.fn(),
      onOptionsChange: vi.fn(),
      filterOptions: section,
    };

    expect(toggleRowTarget(engine, { saved: null })).toEqual({
      engine,
      section,
      saved: null,
    });
  });

  it("answers null when the build moved a member, and reports it once per engine", () => {
    const engine = { options: {}, render: vi.fn() } as GraphEngine;

    expect(toggleRowTarget(engine, { saved: null })).toBeNull();
    expect(toggleRowTarget(engine, { saved: null })).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });
});
