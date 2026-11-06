import { describe, expect, it } from "vitest";

import {
  INITIAL_PANELS,
  placePanels,
  previewBelowHeight,
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

  it("gives up height first, so the editor keeps 240 px", () => {
    // 80 % of 500 is 400 px, which would leave the editor 100 px.
    expect(previewBelowHeight(80, 500)).toBe(260);
    expect(previewBelowHeight(40, 500)).toBe(200);
  });

  it("has no height in a view shorter than the editor's floor", () => {
    expect(previewBelowHeight(40, 200)).toBe(0);
  });
});
