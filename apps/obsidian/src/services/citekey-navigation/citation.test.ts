// @vitest-environment happy-dom
import { Keymap, Menu } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaults } from "@/services/settings/schema";

import { attachCitationHover, attachCitationNavigation } from "./citation";
import type { CitationHoverRequest } from "./citation";
import { CITEKEY_HOVER_SOURCE, hoverPreferences } from "./hover";
import type { HoverPreferences } from "./hover";
import type { CitedWork, NavigationPane } from "./intent";
import type { GestureSurface } from "./shell";

const menuMock = Menu as typeof Menu & {
  instances: { items: { title: string; click: () => void }[] }[];
};

const work = (citekey: string, label: string): CitedWork => ({
  citekey,
  label,
});

/** One `hover-link` the Page preview core plugin was asked to answer. */
type HoverLink = Record<string, unknown>;

function citation(
  works: readonly CitedWork[],
  where: GestureSurface = { surface: "reading" },
  hover: HoverPreferences = hoverPreferences(defaults),
) {
  const element = document.createElement("span");
  const opened: [citekey: string, pane: NavigationPane][] = [];
  const requests: CitationHoverRequest[] = [];
  const links: [event: string, link: HoverLink][] = [];
  const navigation = {
    works,
    where,
    open: (citekey: string, pane: NavigationPane) =>
      opened.push([citekey, pane]),
    showPopover: (request: CitationHoverRequest) => requests.push(request),
    hoverPreferences: () => hover,
    hoverNotePath: (citekey: string) =>
      citekey === "doe2024" ? "lit/doe2024.md" : null,
    hoverTarget: () => ({
      workspace: {
        trigger: (event: string, link: HoverLink) => links.push([event, link]),
      },
      hoverParent: { hoverPopover: null },
      sourcePath: "draft.md",
    }),
  };
  return { element, opened, requests, links, navigation };
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
      works: [work("doe2024", "Doe (2024)"), work("smith2025", "Smith (2025)")],
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

describe("attachCitationNavigation under Page preview", () => {
  const preview: HoverPreferences = {
    ...hoverPreferences(defaults),
    action: "page-preview",
  };

  function previewing(works: readonly CitedWork[]) {
    const parts = citation(works, { surface: "reading" }, preview);
    attachCitationNavigation(parts.element, parts.navigation);
    return parts;
  }

  it("asks the Page preview core plugin for the one note the citation names", () => {
    const { element, links, requests } = previewing([
      work("doe2024", "Doe (2024)"),
    ]);
    const event = new MouseEvent("mouseover", { bubbles: true });

    element.dispatchEvent(event);

    expect(requests).toEqual([]);
    expect(links).toHaveLength(1);
    expect(links[0]?.[0]).toBe("hover-link");
    expect(links[0]?.[1]).toEqual({
      event,
      hoverParent: { hoverPopover: null },
      targetEl: element,
      linktext: "lit/doe2024.md",
      sourcePath: "draft.md",
      source: CITEKEY_HOVER_SOURCE,
    });
  });

  it("previews nothing for a multi-item citation", () => {
    const { element, links } = previewing([
      work("doe2024", "Doe (2024)"),
      work("smith2025", "Smith (2025)"),
    ]);

    element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    expect(links).toEqual([]);
  });

  it("previews nothing for a key naming zero or several notes", () => {
    const { element, links } = previewing([work("typo2024", "@typo2024")]);

    element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    expect(links).toEqual([]);
  });
});

describe("attachCitationNavigation under Off", () => {
  it("adds no hover result, and leaves the click alone", () => {
    const parts = citation([work("doe2024", "Doe (2024)")], undefined, {
      ...hoverPreferences(defaults),
      action: "off",
    });
    attachCitationNavigation(parts.element, parts.navigation);

    parts.element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    parts.element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    expect(parts.requests).toEqual([]);
    expect(parts.links).toEqual([]);
    expect(parts.opened).toEqual([["doe2024", false]]);
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

    expect(requests.map(({ works }) => works)).toEqual([
      [work("typo2024", "@typo2024")],
    ]);
    expect(opened).toEqual([]);
  });
});
