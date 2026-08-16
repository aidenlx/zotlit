// @vitest-environment happy-dom
import { Keymap, Menu } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaults } from "@/services/settings/schema";

import {
  attachCitationHover,
  attachCitationNavigation,
  attachClosedCitationGestures,
  clickWikilinkCitation,
  markCitationClick,
} from "./citation";
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

describe("attachClosedCitationGestures", () => {
  function attachClosed(
    works: readonly CitedWork[],
    where: GestureSurface = { surface: "reading" },
    hover: HoverPreferences = hoverPreferences(defaults),
  ) {
    const parts = citation(works, where, hover);
    attachClosedCitationGestures(parts.element, parts.navigation);
    return parts;
  }

  const click = (overrides: MouseEventInit = {}): MouseEvent =>
    new MouseEvent("click", { bubbles: true, cancelable: true, ...overrides });

  // An earlier suite may have left a modifier held; every click here names its
  // own modifiers.
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("leaves a plain reading-mode click to the platform", () => {
    const { element, requests, opened } = attachClosed([
      work("doe2024", "Doe (2024)"),
      work("smith2025", "Smith (2025)"),
    ]);
    const event = click();

    element.dispatchEvent(event);

    expect(opened).toEqual([]);
    expect(requests).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it("leaves a plain Live Preview click to the caret the browser places", () => {
    const { element, requests, opened } = attachClosed(
      [work("doe2024", "Doe (2024)")],
      { surface: "editor", editorMode: "live-preview" },
    );
    const down = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    const event = click();

    element.dispatchEvent(down);
    element.dispatchEvent(event);

    // The selection the caret places reveals the Citation's source text.
    expect(down.defaultPrevented).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(opened).toEqual([]);
    expect(requests).toEqual([]);
  });

  it("keeps the hover the Hover Action names", () => {
    const { element, requests } = attachClosed([work("doe2024", "Doe (2024)")]);

    element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    expect(requests).toHaveLength(1);
  });

  it("opens the work a Mod-click names, through the shared navigation flow", () => {
    vi.spyOn(Keymap, "isModifier").mockReturnValue(true);
    vi.spyOn(Keymap, "isModEvent").mockReturnValue("tab");
    const { element, requests, opened } = attachClosed([
      work("doe2024", "Doe (2024)"),
    ]);

    element.dispatchEvent(click({ ctrlKey: true }));

    expect(opened).toEqual([["doe2024", "tab"]]);
    expect(requests).toEqual([]);
  });

  it("leaves a middle click inert", () => {
    const { element, requests, opened } = attachClosed([
      work("doe2024", "Doe (2024)"),
    ]);

    element.dispatchEvent(new MouseEvent("mousedown", { button: 1 }));
    element.dispatchEvent(click({ button: 1 }));

    expect(opened).toEqual([]);
    expect(requests).toEqual([]);
  });
});

describe("markCitationClick", () => {
  it("states what a plain click does, and takes the cursor from it", () => {
    const element = document.createElement("span");

    markCitationClick(element, "edit");

    expect(element.dataset.ztClick).toBe("edit");
    expect(
      element.classList.contains("zt:data-[zt-click=edit]:cursor-text"),
    ).toBe(true);
  });

  it("leaves the cursor to a stylesheet where the caller asks", () => {
    const element = document.createElement("a");

    markCitationClick(element, "none", { cursor: false });

    expect(element.dataset.ztClick).toBe("none");
    expect(element.classList).toHaveLength(0);
  });
});

describe("clickWikilinkCitation", () => {
  // An earlier suite may have left a modifier held; every click here names its
  // own modifiers.
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function clicked(
    event: MouseEvent,
    where: GestureSurface = { surface: "reading" },
  ) {
    const parts = citation([work("doe2024", "Doe (2024)")], where);
    /** Every click Obsidian's own delegated handler would have answered. */
    const native: MouseEvent[] = [];
    /** Every click the surface answered with the caret. */
    const edited: MouseEvent[] = [];
    // The container the delegated handler sits on, as Obsidian hangs it above
    // the link rather than on it.
    const container = document.createElement("div");
    container.append(parts.element);
    container.addEventListener("click", (reached) =>
      native.push(reached as MouseEvent),
    );
    parts.element.addEventListener("click", (own) => {
      clickWikilinkCitation(own, {
        where,
        edit: (reached) => edited.push(reached),
      });
    });
    parts.element.dispatchEvent(event);
    return { ...parts, native, edited };
  }

  const click = (overrides: MouseEventInit = {}): MouseEvent =>
    new MouseEvent("click", { bubbles: true, cancelable: true, ...overrides });

  it("swallows a plain reading-mode click, and edits nothing", () => {
    const event = click();

    const { requests, native, edited } = clicked(event);

    expect(requests).toEqual([]);
    expect(edited).toEqual([]);
    expect(event.defaultPrevented).toBe(true);
    expect(native).toEqual([]);
  });

  it("answers a plain Live Preview click with the caret, and stops there", () => {
    const event = click();

    const { native, edited } = clicked(event, {
      surface: "editor",
      editorMode: "live-preview",
    });

    expect(edited).toEqual([event]);
    expect(event.defaultPrevented).toBe(true);
    expect(native).toEqual([]);
  });

  it("leaves a Mod-click to Obsidian", () => {
    vi.spyOn(Keymap, "isModifier").mockReturnValue(true);
    const event = click({ ctrlKey: true });

    const { opened, native, edited } = clicked(event, {
      surface: "editor",
      editorMode: "live-preview",
    });

    expect(opened).toEqual([]);
    expect(edited).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
    expect(native).toHaveLength(1);
  });

  it("leaves a click of another button to Obsidian", () => {
    const event = click({ button: 1 });

    const { native, edited } = clicked(event);

    expect(edited).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
    expect(native).toHaveLength(1);
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
