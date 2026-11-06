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
import type { PanelPlacement, WorkbenchPanels } from "./panel-layout";

/** The panels at their initial widths (400 px each), shown as `shown` says. */
const shown = (fields: boolean, preview: boolean): WorkbenchPanels => ({
  fields: { ...INITIAL_PANELS.fields, shown: fields },
  preview: { ...INITIAL_PANELS.preview, shown: preview },
});

const at = (width: number) => ({ width, height: 800 });

describe("panel placement", () => {
  // The worked examples, at the initial 400 px widths. A panel is drawn at
  // most 2/5 of the view and never under 240 px: at 760 px a panel is 304 px,
  // at 960 px 384 px, and at 1200 px its saved 400 px.
  it.each<{
    width: number;
    both: PanelPlacement;
    preview: PanelPlacement;
    fields: PanelPlacement;
  }>([
    {
      width: 320,
      both: { preview: "below", fields: "popover" },
      preview: { preview: "below", fields: "popover" },
      fields: { preview: "hidden", fields: "popover" },
    },
    {
      width: 560,
      both: { preview: "below", fields: "popover" },
      preview: { preview: "below", fields: "popover" },
      fields: { preview: "hidden", fields: "popover" },
    },
    {
      width: 760,
      both: { preview: "side", fields: "popover" },
      preview: { preview: "side", fields: "popover" },
      fields: { preview: "hidden", fields: "column" },
    },
    {
      width: 960,
      both: { preview: "side", fields: "popover" },
      preview: { preview: "side", fields: "popover" },
      fields: { preview: "hidden", fields: "column" },
    },
    {
      width: 1200,
      both: { preview: "side", fields: "column" },
      preview: { preview: "side", fields: "column" },
      fields: { preview: "hidden", fields: "column" },
    },
  ])(
    "places the panels of a $width px view",
    ({ width, both, preview, fields }) => {
      // Both shown, the Preview alone, and the Fields Panel alone.
      expect(placePanels(shown(true, true), at(width))).toEqual(both);
      expect(placePanels(shown(false, true), at(width))).toEqual(preview);
      expect(placePanels(shown(true, false), at(width))).toEqual(fields);
    },
  );

  it("answers where Fields would go while the Fields Panel is hidden", () => {
    // The Fields action reads it: a narrow view opens a popover, not a column.
    expect(placePanels(shown(false, false), at(560))).toEqual({
      preview: "hidden",
      fields: "popover",
    });
    expect(placePanels(shown(false, false), at(760))).toEqual({
      preview: "hidden",
      fields: "column",
    });
  });

  it("puts the Preview at the side once the editor keeps 360 px beside it", () => {
    // 600 px less the 240 px Preview leaves the editor exactly 360 px.
    expect(placePanels(shown(false, true), at(600)).preview).toBe("side");
    expect(placePanels(shown(false, true), at(599)).preview).toBe("below");
  });

  it("gives three columns sooner to a reader who narrows the panels", () => {
    const narrow: WorkbenchPanels = {
      fields: { ...INITIAL_PANELS.fields, shown: true, width: 240 },
      preview: { ...INITIAL_PANELS.preview, shown: true, width: 240 },
    };
    // 960 - 240 - 240 leaves the editor 480 px.
    expect(placePanels(narrow, at(960))).toEqual({
      preview: "side",
      fields: "column",
    });
    // 760 - 240 - 240 leaves 280 px, under the editor's 360.
    expect(placePanels(narrow, at(760))).toEqual({
      preview: "side",
      fields: "popover",
    });
  });

  it("lets a wide saved Preview move the Fields Panel out of its column", () => {
    const wide: WorkbenchPanels = {
      fields: { ...INITIAL_PANELS.fields, shown: true },
      preview: { ...INITIAL_PANELS.preview, shown: true, width: 960 },
    };
    // The Preview is drawn at 2/5 of 1200, 480 px; 1200 - 480 - 400 is 320.
    expect(placePanels(wide, at(1200))).toEqual({
      preview: "side",
      fields: "popover",
    });
  });

  it("places columns where the host has not measured the view yet", () => {
    expect(placePanels(shown(true, true), null)).toEqual({
      preview: "side",
      fields: "column",
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
  const both = shown(true, true);
  const bounds = (width: number) => ({
    size: at(width),
    defaults: INITIAL_PANELS,
  });

  it("offers the handles the view draws", () => {
    expect(panelHandles(both, at(1200))).toEqual(["fields", "preview"]);
    // At 560 px the Preview stands under the editor and the Fields Panel
    // opens as a popover, which has no edge.
    expect(panelHandles(both, at(560))).toEqual(["split"]);
    expect(panelHandles(shown(false, false), at(1200))).toEqual([]);
  });

  it("widens and narrows a column a large step at a time", () => {
    const wider = resizePanel("fields", "grow", bounds(1600))(both);
    expect(wider.fields.width).toBe(464);
    expect(
      resizePanel("preview", "shrink", bounds(1600))(both).preview.width,
    ).toBe(336);
    // The other panel keeps its size.
    expect(wider.preview).toBe(both.preview);
  });

  it("widens a column only as far as the view draws it", () => {
    // 2/5 of 1600 px is 640 px.
    const fields: WorkbenchPanels = {
      ...both,
      preview: { ...both.preview, shown: false },
    };
    const grow = resizePanel("fields", "grow", bounds(1600));
    const wide = grow(grow(grow(grow(fields))));
    expect(wide.fields.width).toBe(640);
    expect(canResizePanel("fields", "grow", bounds(1600))(wide)).toBe(false);
    expect(canResizePanel("fields", "shrink", bounds(1600))(wide)).toBe(true);
  });

  it("widens a column only while the editor keeps its 360 px beside both columns", () => {
    // 1200 px less the 400 px Preview and the editor's 360 px leaves the
    // Fields column at most 440 px, under the 480 px 2/5 limit.
    expect(columnLimit(both, "fields", at(1200))).toBe(440);
    const grow = resizePanel("fields", "grow", bounds(1200));
    let panels = both;
    for (let press = 0; press < 5; press++) panels = grow(panels);
    expect(panels.fields.width).toBe(440);
    expect(placePanels(panels, at(1200))).toEqual({
      preview: "side",
      fields: "column",
    });
    expect(canResizePanel("fields", "grow", bounds(1200))(panels)).toBe(false);
    // The Fields column now takes the room the Preview could grow into.
    expect(columnLimit(panels, "preview", at(1200))).toBe(400);
    expect(canResizePanel("preview", "grow", bounds(1200))(panels)).toBe(false);
    expect(
      placePanels(
        resizePanel("preview", "grow", bounds(1200))(panels),
        at(1200),
      ).fields,
    ).toBe("column");
  });

  it("limits a column by the other one only while that one is a column", () => {
    const preview: WorkbenchPanels = {
      ...both,
      fields: { ...both.fields, shown: false },
    };
    // A hidden Fields Panel leaves the Preview its 2/5 of the view.
    expect(columnLimit(preview, "preview", at(1200))).toBe(480);
    // A hidden Preview leaves the Fields column 2/5 of a 700 px view, as the
    // editor keeps 420 px beside it.
    const fields: WorkbenchPanels = {
      ...both,
      preview: { ...both.preview, shown: false },
    };
    expect(columnLimit(fields, "fields", at(700))).toBe(280);
    // A view not measured yet holds a column to its largest width.
    expect(columnLimit(both, "fields", null)).toBe(960);
  });

  it("resets a column no wider than the editor's room allows", () => {
    const wide: WorkbenchPanels = {
      fields: { ...both.fields, width: 300 },
      preview: { ...both.preview, width: 480 },
    };
    // 1200 - 480 - 360 leaves the Fields column 360 px, under its 400 px default.
    const reset = resizePanel("fields", "reset", bounds(1200))(wide);
    expect(reset.fields.width).toBe(360);
    expect(placePanels(reset, at(1200)).fields).toBe("column");
  });

  it("stops at the narrowest column", () => {
    const narrow: WorkbenchPanels = {
      ...both,
      fields: { ...both.fields, width: 260 },
    };
    const narrowest = resizePanel("fields", "shrink", bounds(1200))(narrow);
    expect(narrowest.fields.width).toBe(240);
    expect(canResizePanel("fields", "shrink", bounds(1200))(narrowest)).toBe(
      false,
    );
  });

  it("makes the Preview under the editor taller and shorter by a tenth of the view", () => {
    expect(resizePanel("split", "grow", bounds(560))(both).preview.height).toBe(
      50,
    );
    expect(
      resizePanel("split", "shrink", bounds(560))(both).preview.height,
    ).toBe(30);
    const tallest: WorkbenchPanels = {
      ...both,
      preview: { ...both.preview, height: 80 },
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
    const taller = resizePanel("split", "grow", short)(both);
    expect(previewBelowHeight(taller.preview.height, 578)).toBe(258);
    expect(canResizePanel("split", "grow", short)(taller)).toBe(false);
    // A saved 80 % draws as 45 %; one step shorter draws shorter.
    const tallest: WorkbenchPanels = {
      ...both,
      preview: { ...both.preview, height: 80 },
    };
    expect(canResizePanel("split", "grow", short)(tallest)).toBe(false);
    const shorter = resizePanel("split", "shrink", short)(tallest);
    expect(shorter.preview.height).toBe(35);
    expect(previewBelowHeight(shorter.preview.height, 578)).toBeLessThan(258);
  });

  it("resets a panel to its default size", () => {
    const sized: WorkbenchPanels = {
      fields: { ...both.fields, width: 300 },
      preview: { ...both.preview, width: 960, height: 70 },
    };
    expect(
      resizePanel("fields", "reset", bounds(1600))(sized).fields.width,
    ).toBe(400);
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
    expect(canResizePanel("fields", "reset", bounds(1200))(both)).toBe(false);
    expect(canResizePanel("split", "reset", bounds(560))(sized)).toBe(true);
  });

  it("resets to the host's own default sizes", () => {
    // The web Workbench starts its Fields Panel at 288 px.
    const page: WorkbenchPanels = {
      ...both,
      fields: { ...both.fields, width: 288 },
    };
    const web = { size: at(1200), defaults: page };
    expect(resizePanel("fields", "reset", web)(both).fields.width).toBe(288);
    expect(canResizePanel("fields", "reset", web)(page)).toBe(false);
  });
});
