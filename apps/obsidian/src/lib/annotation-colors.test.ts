// @vitest-environment happy-dom
// The colour menu builds its titles with `createFragment`, which needs a DOM.
import { Menu } from "@mock/obsidian";
import { describe, expect, it, vi } from "vitest";

import {
  ANNOTATION_COLORS,
  annotationColorLabel,
  buildColorMenu,
} from "./annotation-colors";

describe("the colour menu", () => {
  function build(color: string | null) {
    const onSelect = vi.fn();
    const menu = new Menu();
    buildColorMenu(menu as never, { color, onSelect });
    return { menu, onSelect };
  }

  it("offers Zotero's eight swatches by name, in Zotero's order", () => {
    const { menu } = build(null);

    expect(menu.items.map((item) => item.title)).toStrictEqual(
      ANNOTATION_COLORS.map((hex) => annotationColorLabel(hex)),
    );
  });

  it("carries the colour itself beside each name", () => {
    const { menu } = build(null);
    const swatch =
      menu.items[0]!.titleFragment?.querySelector<HTMLElement>("[style]");

    expect(swatch?.style.backgroundColor).toBe(ANNOTATION_COLORS[0]);
  });

  it("checks the swatch the Annotation carries, whatever case it was stored in", () => {
    const { menu } = build("#FFD400");

    expect(menu.items.filter((item) => item.checked)).toHaveLength(1);
    expect(menu.items[0]!.checked).toBe(true);
  });

  it("recolours from the entry", () => {
    const { menu, onSelect } = build(null);

    menu.items[2]!.click();
    expect(onSelect).toHaveBeenCalledWith(ANNOTATION_COLORS[2]);
  });
});
