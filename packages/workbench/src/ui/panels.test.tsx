import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as Atom from "effect/reactivity/Atom";
import { afterEach, describe, expect, it } from "vitest";

import { INITIAL_PANELS } from "./panel-layout";
import type { ViewSize, WorkbenchPanels } from "./panel-layout";
import { SidePanels } from "./panels";
import { mount } from "./test-host";

afterEach(cleanup);

const BOTH: WorkbenchPanels = {
  ...INITIAL_PANELS,
  preview: { ...INITIAL_PANELS.preview, shown: true },
};

function open(size: ViewSize) {
  const viewSize = Atom.make<ViewSize | null>(size);
  const mounted = mount(
    <SidePanels
      panels={{
        fields: {
          label: "Fields",
          resizeLabel: "Resize fields",
          content: "Field list",
        },
        preview: {
          label: "Preview",
          resizeLabel: "Resize preview",
          content: "Rendered note",
        },
      }}
    >
      <p>Template source</p>
    </SidePanels>,
    { panels: BOTH, viewSize },
  );
  render(mounted.ui);
  return Object.assign(mounted, {
    resize: (next: ViewSize) => act(() => mounted.registry.set(viewSize, next)),
  });
}

/** The regions' names and the editor's text in document order. */
const order = () =>
  [...document.querySelectorAll<HTMLElement>("[role=region], p")].map(
    (element) => {
      const nameId = element.getAttribute("aria-labelledby");
      return nameId === null
        ? element.textContent
        : document.getElementById(nameId)!.textContent;
    },
  );

describe("the side panels", () => {
  it("puts the Preview under the editor in a narrow view, and beside it in a wide one, with no Fields column", () => {
    using page = open({ width: 560, height: 800 });
    const split = screen.getByRole("separator", { name: "Resize preview" });
    expect(split.getAttribute("aria-orientation")).toBe("horizontal");
    expect(order()).toEqual(["Template source", "Preview"]);
    // A host draws `aria-label` as a hover tooltip; the region shows none.
    expect(
      screen
        .getByRole("region", { name: "Preview" })
        .hasAttribute("aria-label"),
    ).toBe(false);
    const panels = page.registry.get(page.model.panels);
    page.resize({ width: 1200, height: 800 });
    expect(
      screen
        .getByRole("separator", { name: "Resize preview" })
        .getAttribute("aria-orientation"),
    ).toBe("vertical");
    expect(order()).toEqual(["Template source", "Preview"]);
    // The resize moved the Preview and kept what the reader chose.
    expect(page.registry.get(page.model.panels)).toBe(panels);
  });

  it("sets the Preview's height under the editor with the arrow keys", () => {
    using page = open({ width: 560, height: 800 });
    const split = screen.getByRole("separator", { name: "Resize preview" });
    expect(split.getAttribute("aria-valuenow")).toBe("40");
    fireEvent.keyDown(split, { key: "ArrowUp" });
    expect(page.registry.get(page.model.panels).preview.height).toBe(45);
    fireEvent.keyDown(split, { key: "ArrowDown" });
    fireEvent.keyDown(split, { key: "ArrowDown" });
    expect(page.registry.get(page.model.panels).preview.height).toBe(35);
    fireEvent.keyDown(split, { key: "End" });
    expect(page.registry.get(page.model.panels).preview.height).toBe(80);
  });

  it("counts each press of a quick run of presses", () => {
    using page = open({ width: 560, height: 800 });
    const split = screen.getByRole("separator", { name: "Resize preview" });
    act(() => {
      for (let press = 0; press < 2; press++)
        split.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
        );
    });
    expect(page.registry.get(page.model.panels).preview.height).toBe(50);
  });

  it("resets a panel's size when the reader double-clicks its handle", () => {
    // The browser's own event: Preact's testing library names it otherwise.
    const doubleClick = (handle: HTMLElement) =>
      act(() => {
        handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      });
    using page = open({ width: 560, height: 800 });
    const split = screen.getByRole("separator", { name: "Resize preview" });
    fireEvent.keyDown(split, { key: "End" });
    doubleClick(split);
    expect(page.registry.get(page.model.panels).preview.height).toBe(40);
    page.resize({ width: 1200, height: 800 });
    const edge = screen.getByRole("separator", { name: "Resize preview" });
    fireEvent.keyDown(edge, { key: "Home" });
    expect(page.registry.get(page.model.panels).preview.width).toBe(240);
    doubleClick(edge);
    expect(page.registry.get(page.model.panels).preview.width).toBe(400);
  });

  it("describes the Preview's edge at the width the view draws it", () => {
    using page = open({ width: 1200, height: 800 });
    const edge = screen.getByRole("separator", { name: "Resize preview" });
    // 1200 px less the editor's 360 px.
    expect(edge.getAttribute("aria-valuemax")).toBe("840");
    expect(edge.getAttribute("aria-valuenow")).toBe("400");
    // The Preview's edge grows toward the leading side.
    fireEvent.keyDown(edge, { key: "ArrowLeft" });
    expect(page.registry.get(page.model.panels).preview.width).toBe(416);
  });
});
