import { describe, expect, it } from "vitest";

import { INITIAL_PANELS } from "./panel-layout";
import type { WorkbenchPanels } from "./panel-layout";
import { panelSizeMenus } from "./panel-menu";
import { m } from "./test-messages";

const BOTH: WorkbenchPanels = {
  fields: { ...INITIAL_PANELS.fields, shown: true },
  preview: { ...INITIAL_PANELS.preview, shown: true },
};

/** A view `width` pixels wide whose panels start from the initial ones. */
const at = (width: number) => ({
  size: { width, height: 800 },
  defaults: INITIAL_PANELS,
});

/** Each menu's name, axis and entries, with a mark on the ones turned off. */
const read = (menus: ReturnType<typeof panelSizeMenus>) =>
  menus.map((menu) => [
    menu.label,
    menu.axis,
    menu.items.map((item) => (item.disabled ? `(${item.label})` : item.label)),
  ]);

describe("the panel size menus", () => {
  it("names each handle the view draws, with entries for its direction", () => {
    const widths = [
      m.workbench_panel_wider(),
      m.workbench_panel_narrower(),
      `(${m.workbench_panel_reset_width()})`,
    ];
    expect(read(panelSizeMenus(m, BOTH, at(1200)))).toEqual([
      [m.workbench_fields_resize(), "horizontal", widths],
      [m.workbench_preview_resize(), "horizontal", widths],
    ]);
    expect(read(panelSizeMenus(m, BOTH, at(560)))).toEqual([
      [
        m.workbench_preview_resize(),
        "vertical",
        [
          m.workbench_panel_taller(),
          m.workbench_panel_shorter(),
          `(${m.workbench_panel_reset_height()})`,
        ],
      ],
    ]);
  });

  it("sizes the panel of the entry the reader picks", () => {
    // Wide enough to keep both columns at the wider Fields width.
    const size = at(1600);
    const [fields] = panelSizeMenus(m, BOTH, size);
    const wider = fields!.items[0]!.apply(BOTH);
    expect(wider.fields.width).toBe(464);
    const [again] = panelSizeMenus(m, wider, size);
    // The width is no longer the default, so it can be reset.
    expect(again!.items[2]!.disabled).toBe(false);
    expect(again!.items[2]!.apply(wider).fields.width).toBe(400);
  });
});
