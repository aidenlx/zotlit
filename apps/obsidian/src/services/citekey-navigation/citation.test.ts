// @vitest-environment happy-dom
import { Keymap, Menu } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { attachCitationHover, attachCitationNavigation } from "./citation";
import type { CitationHoverRequest } from "./citation";
import type { CitedWork, NavigationPane } from "./intent";
import type { GestureSurface } from "./shell";

const menuMock = Menu as typeof Menu & {
  instances: { items: { title: string; click: () => void }[] }[];
};

const work = (citekey: string, label: string): CitedWork => ({
  citekey,
  label,
});

function citation(
  works: readonly CitedWork[],
  where: GestureSurface = { surface: "reading" },
) {
  const element = document.createElement("span");
  const opened: [citekey: string, pane: NavigationPane][] = [];
  const requests: CitationHoverRequest[] = [];
  const navigation = {
    works,
    where,
    open: (citekey: string, pane: NavigationPane) =>
      opened.push([citekey, pane]),
    showPopover: (request: CitationHoverRequest) => requests.push(request),
    hoverTarget: () => ({
      hoverParent: { hoverPopover: null },
      sourcePath: "draft.md",
    }),
  };
  return { element, opened, requests, navigation };
}

function attach(
  works: readonly CitedWork[],
  where: GestureSurface = { surface: "reading" },
) {
  const parts = citation(works, where);
  attachCitationNavigation(parts.element, parts.navigation);
  return parts;
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

  it("shows the popover of every work the citation names", () => {
    const { element, requests, navigation } = attach([
      work("doe2024", "Doe (2024)"),
      work("smith2025", "Smith (2025)"),
    ]);
    const event = new MouseEvent("mouseover", { bubbles: true });

    element.dispatchEvent(event);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({
      event,
      targetEl: element,
      hoverParent: { hoverPopover: null },
      sourcePath: "draft.md",
      citekeys: ["doe2024", "smith2025"],
      open: navigation.open,
    });
  });

  it("hovers once while the pointer moves inside one citation", () => {
    const { element, requests } = attach([work("doe2024", "Doe (2024)")]);
    const inner = element.appendChild(document.createElement("em"));

    element.dispatchEvent(
      new MouseEvent("mouseover", { bubbles: true, relatedTarget: inner }),
    );

    expect(requests).toEqual([]);
  });

  it("holds a Source-mode hover back until Mod is held", () => {
    const { element, requests } = attach([work("doe2024", "Doe (2024)")], {
      surface: "editor",
      editorMode: "source",
    });

    element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(requests).toEqual([]);

    vi.spyOn(Keymap, "isModifier").mockReturnValue(true);
    element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(requests).toHaveLength(1);
  });

  it("shows nothing while the citation sits in no view", () => {
    const { element, requests, navigation } = citation([
      work("doe2024", "Doe (2024)"),
    ]);
    attachCitationNavigation(element, {
      ...navigation,
      hoverTarget: () => null,
    });

    element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    expect(requests).toEqual([]);
  });
});

describe("attachCitationHover", () => {
  it("hovers a citation that has nothing to open, and leaves its clicks alone", () => {
    const { element, requests, opened, navigation } = citation([
      work("typo2024", "@typo2024"),
    ]);
    attachCitationHover(element, navigation);

    element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    expect(requests.map(({ citekeys }) => citekeys)).toEqual([["typo2024"]]);
    expect(opened).toEqual([]);
  });
});
