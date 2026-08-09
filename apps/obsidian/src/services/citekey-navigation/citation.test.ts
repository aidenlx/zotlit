// @vitest-environment happy-dom
import { Menu } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { attachCitationNavigation } from "./citation";
import { CITEKEY_HOVER_SOURCE } from "./intent";
import type { CitedWork, NavigationPane } from "./intent";

const menuMock = Menu as typeof Menu & {
  instances: { items: { title: string; click: () => void }[] }[];
};

const work = (citekey: string, label: string): CitedWork => ({
  citekey,
  label,
});

function attach(works: readonly CitedWork[]) {
  const element = document.createElement("span");
  const opened: [citekey: string, pane: NavigationPane][] = [];
  const trigger = vi.fn();
  attachCitationNavigation(element, {
    works,
    where: { surface: "reading" },
    open: (citekey, pane) => opened.push([citekey, pane]),
    hoverNotePath: (citekey) => `literatures/${citekey}.md`,
    hoverTarget: () => ({
      workspace: { trigger },
      hoverParent: {} as never,
      sourcePath: "draft.md",
    }),
  });
  return { element, opened, trigger };
}

beforeEach(() => {
  menuMock.instances = [];
});

describe("attachCitationNavigation", () => {
  it("opens the single work through the shared navigation flow", () => {
    const { element, opened } = attach([work("doe2024", "Doe (2024)")]);

    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    expect(opened).toEqual([["doe2024", false]]);
  });

  it("shows the existing item menu for a multi-work Citation", () => {
    const { element, opened } = attach([
      work("doe2024", "Doe (2024)"),
      work("smith2025", "Smith (2025)"),
    ]);

    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    const menu = menuMock.instances[0];
    expect(menu?.items.map((item) => item.title)).toEqual([
      "Doe (2024)",
      "Smith (2025)",
    ]);
    expect(opened).toEqual([]);
    menu?.items[1]?.click();
    expect(opened).toEqual([["smith2025", false]]);
  });

  it("previews the Literature Note of a single work", () => {
    const { element, trigger } = attach([work("doe2024", "Doe (2024)")]);
    const event = new MouseEvent("mouseover", { bubbles: true });

    element.dispatchEvent(event);

    expect(trigger).toHaveBeenCalledExactlyOnceWith("hover-link", {
      event,
      hoverParent: {},
      targetEl: element,
      linktext: "literatures/doe2024.md",
      sourcePath: "draft.md",
      source: CITEKEY_HOVER_SOURCE,
    });
  });
});
