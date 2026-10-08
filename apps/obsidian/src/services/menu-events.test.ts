import { Menu } from "@mock/obsidian";
import { describe, expect, it, vi } from "vitest";

import { menuSections, raiseMenu } from "./menu-events";

describe("raiseMenu", () => {
  it("registers the menu's sections before its listeners run", () => {
    const menu = new Menu();
    const sectionsSeen: string[][] = [];
    const trigger = vi.fn(() => sectionsSeen.push([...menu.sections]));

    raiseMenu(menu as never, {
      workspace: { trigger },
      name: "zotlit:cited-works-menu",
      info: { works: [] },
    });

    expect(sectionsSeen).toStrictEqual([["open", ""]]);
    expect(trigger).toHaveBeenCalledExactlyOnceWith(
      "zotlit:cited-works-menu",
      menu,
      { works: [] },
    );
  });
});

describe("menuSections", () => {
  it("names every section of the menu but the unnamed one", () => {
    expect(menuSections("zotlit:annotation-menu")).toStrictEqual({
      action: "action",
      clipboard: "clipboard",
      insert: "insert",
      view: "view",
      danger: "danger",
    });
  });
});
