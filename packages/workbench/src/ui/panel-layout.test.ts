import { describe, expect, it } from "vitest";

import {
  canResizePanel,
  columnLimit,
  INITIAL_PANELS,
  panelHandles,
  placePanels,
  previewBelowHeight,
  resizePanel,
} from "./panel-layout";
import type { WorkbenchPanels } from "./panel-layout";

/** The panels at their initial sizes, with the Preview shown as `preview` says. */
const shown = (preview: boolean): WorkbenchPanels => ({
  ...INITIAL_PANELS,
  preview: { ...INITIAL_PANELS.preview, shown: preview },
});

const at = (width: number) => ({ width, height: 800 });

describe("panel placement", () => {
  // The Preview is a column from 896 px (56rem) and goes under the editor in
  // a narrower view. The Fields Panel opens as a popover over the editor at every width,
  // and only the Fields action opens it.
  it.each([320, 560, 760, 960, 1200])(
    "opens the Fields Panel as a popover over a %i px view only while it stands open",
    (width) => {
      const preview = width >= 896 ? "side" : "below";
      expect(placePanels(shown(true), at(width), true)).toEqual({
        preview,
        fields: "popover",
      });
      expect(placePanels(shown(true), at(width), false)).toEqual({
        preview,
        fields: "closed",
      });
      expect(placePanels(shown(false), at(width), true)).toEqual({
        preview: "hidden",
        fields: "popover",
      });
    },
  );

  it("puts the Preview at the side from a 56rem (896 px) view", () => {
    expect(placePanels(shown(true), at(896), false).preview).toBe("side");
    expect(placePanels(shown(true), at(895), false).preview).toBe("below");
    // A narrow Preview goes under the editor too, though the editor would
    // keep its 360 px beside it.
    const narrow: WorkbenchPanels = {
      ...shown(true),
      preview: { ...INITIAL_PANELS.preview, shown: true, width: 240 },
    };
    expect(placePanels(narrow, at(895), false).preview).toBe("below");
  });

  it("draws a wide saved Preview as wide as the editor's 360 px allows", () => {
    const wide: WorkbenchPanels = {
      ...shown(true),
      preview: { ...INITIAL_PANELS.preview, shown: true, width: 1400 },
    };
    // 896 - 360 leaves the Preview 536 px; it stays a column.
    expect(placePanels(wide, at(896), false).preview).toBe("side");
    expect(columnLimit(wide, "preview", at(896))).toBe(536);
  });

  it("places the Preview as a column where the host has not measured the view yet", () => {
    expect(placePanels(shown(true), null, false)).toEqual({
      preview: "side",
      fields: "closed",
    });
  });
});

describe("Preview height under the editor", () => {
  it("takes its saved share of the view height", () => {
    expect(previewBelowHeight(40, 800)).toBe(320);
    expect(previewBelowHeight(25, 800)).toBe(200);
  });

  it("gives up height first, so the editor keeps its toolbar, tabs, task and five source lines", () => {
    // The web Workbench at 320 x 800 lays its panels out 585 px tall. At the
    // largest share, 80 %, the Preview would leave the editor 117 px: less
    // than its toolbar and tabs. It takes 265 px and leaves the editor 320.
    expect(previewBelowHeight(80, 585)).toBe(265);
    // 40 % of 700 px leaves the editor 420 px, past its floor.
    expect(previewBelowHeight(40, 700)).toBe(280);
  });

  it("has no height in a view shorter than the editor's floor", () => {
    expect(previewBelowHeight(40, 300)).toBe(0);
  });
});

describe("sizing a panel without its handle", () => {
  const preview = shown(true);
  const bounds = (width: number) => ({
    size: at(width),
    defaults: INITIAL_PANELS,
  });

  it("offers the handles the view draws", () => {
    expect(panelHandles(preview, at(1200))).toEqual(["preview"]);
    // At 560 px the Preview stands under the editor; the Fields Panel popover has no edge.
    expect(panelHandles(preview, at(560))).toEqual(["split"]);
    expect(panelHandles(shown(false), at(1200))).toEqual([]);
  });

  it("narrows the Preview column a large step at a time", () => {
    expect(
      resizePanel("preview", "shrink", bounds(1600))(preview).preview.width,
    ).toBe(336);
  });

  it("widens the Preview column until the editor keeps only its 360 px", () => {
    // 1600 - 360 leaves the Preview 1240 px.
    const grow = resizePanel("preview", "grow", bounds(1600));
    let panels = preview;
    for (let press = 0; press < 20; press++) panels = grow(panels);
    expect(panels.preview.width).toBe(1240);
    expect(canResizePanel("preview", "grow", bounds(1600))(panels)).toBe(false);
    expect(placePanels(panels, at(1600), false).preview).toBe("side");
    expect(columnLimit(preview, "preview", at(1200))).toBe(840);
  });

  it("draws the Preview at its saved width in a view not measured yet", () => {
    const wide: WorkbenchPanels = {
      ...preview,
      preview: { ...preview.preview, width: 1100 },
    };
    expect(columnLimit(wide, "preview", null)).toBe(1100);
  });

  it("makes the Preview under the editor taller and shorter by a tenth of the view", () => {
    expect(
      resizePanel("split", "grow", bounds(560))(preview).preview.height,
    ).toBe(50);
    expect(
      resizePanel("split", "shrink", bounds(560))(preview).preview.height,
    ).toBe(30);
    const tallest: WorkbenchPanels = {
      ...preview,
      preview: { ...preview.preview, height: 80 },
    };
    expect(canResizePanel("split", "grow", bounds(560))(tallest)).toBe(false);
  });

  it("offers a taller or shorter Preview only where the drawn height changes", () => {
    // A 578 px view keeps the editor 320 px: the Preview draws at most 258
    // px, which 45 % of the view already reaches.
    const short = {
      size: { width: 560, height: 578 },
      defaults: INITIAL_PANELS,
    };
    const taller = resizePanel("split", "grow", short)(preview);
    expect(previewBelowHeight(taller.preview.height, 578)).toBe(258);
    expect(canResizePanel("split", "grow", short)(taller)).toBe(false);
    // A saved 80 % draws as 45 %; one step shorter draws shorter.
    const tallest: WorkbenchPanels = {
      ...preview,
      preview: { ...preview.preview, height: 80 },
    };
    expect(canResizePanel("split", "grow", short)(tallest)).toBe(false);
    const shorter = resizePanel("split", "shrink", short)(tallest);
    expect(shorter.preview.height).toBe(35);
    expect(previewBelowHeight(shorter.preview.height, 578)).toBeLessThan(258);
  });

  it("resets a panel to its default size", () => {
    const sized: WorkbenchPanels = {
      ...preview,
      preview: { ...preview.preview, width: 960, height: 70 },
    };
    expect(
      resizePanel("preview", "reset", bounds(1600))(sized).preview,
    ).toEqual({
      ...sized.preview,
      width: 400,
    });
    expect(resizePanel("split", "reset", bounds(560))(sized).preview).toEqual({
      ...sized.preview,
      height: 40,
    });
    expect(canResizePanel("preview", "reset", bounds(1200))(preview)).toBe(
      false,
    );
    expect(canResizePanel("split", "reset", bounds(560))(sized)).toBe(true);
  });
});

// The web draws a 12 px handle beside each column, which the editor's room counts.
describe("panel placement with handles", () => {
  it("holds the Preview column to the width that leaves the editor 360 px past its handle", () => {
    expect(
      columnLimit(shown(true), "preview", {
        width: 1072,
        height: 800,
        handle: 12,
      }),
    ).toBe(700);
  });
});
