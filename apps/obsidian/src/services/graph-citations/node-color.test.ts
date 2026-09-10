// @vitest-environment happy-dom
import type { GraphData } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import { themeProperty } from "@/lib/theme-hooks";

import { NO_ADDITIONS } from "./adapter";
import type { GraphCitationAdditions } from "./adapter";
import type { GraphLeafMembers } from "./install";
import {
  GraphNodeColors,
  installNodeColors,
  parseGraphColor,
  readNodeColors,
  stampNodeColors,
} from "./node-color";
import { graphNode, themeStates, themeStatesNothing } from "./test-stub";

vi.mock("@/lib/log", () => ({
  getLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

afterEach(() => {
  themeStatesNothing();
  vi.unstubAllGlobals();
});

/** The additions of a render of a vault with one Literature Note, drawn beside one Cited Work Node. */
function additions(): GraphCitationAdditions {
  return {
    ...NO_ADDITIONS,
    citedWorkNodes: new Map([["@typo2024", "typo2024"]]),
    literatureNotes: new Set(["Literature/Doe 2024.md"]),
  };
}

describe("readNodeColors", () => {
  it("reads the colour each theme property states", () => {
    themeStates("rgb(120, 82, 238)", "rgba(136, 136, 136, 0.5)");

    expect(readNodeColors()).toEqual({
      literatureNote: { a: 1, rgb: 0x7852ee },
      citedWorkNode: { a: 0.5, rgb: 0x888888 },
    });
  });

  it("states no colour where the document states none, and leaves nothing behind", () => {
    expect(readNodeColors()).toEqual({
      literatureNote: null,
      citedWorkNode: null,
    });
    expect(document.body.children).toHaveLength(0);
  });

  it("exposes the literal theme properties", () => {
    expect(themeProperty.graphLiteratureNote).toBe(
      "--zt-graph-literature-note-color",
    );
    expect(themeProperty.graphCitedWorkNode).toBe(
      "--zt-graph-cited-work-node-color",
    );
  });

  /**
   * No suite here loads ZotLit's stylesheet, which is the state a graph that
   * was open before ZotLit loaded is drawn in: Obsidian inserts a plugin's
   * stylesheet after the plugin's `onload`.
   */
  it("falls back to ZotLit's default variables where the theme states neither property", () => {
    document.body.style.setProperty("--color-purple", "rgb(120, 82, 238)");
    document.body.style.setProperty("--text-faint", "rgb(171, 171, 171)");

    expect(readNodeColors()).toEqual({
      literatureNote: { a: 1, rgb: 0x7852ee },
      citedWorkNode: { a: 1, rgb: 0xababab },
    });
  });

  it("takes the theme's property over ZotLit's default", () => {
    document.body.style.setProperty("--color-purple", "rgb(120, 82, 238)");
    document.body.style.setProperty("--text-faint", "rgb(171, 171, 171)");
    themeStates("rgb(0, 0, 255)", "rgb(1, 2, 3)");

    expect(readNodeColors()).toEqual({
      literatureNote: { a: 1, rgb: 0x0000ff },
      citedWorkNode: { a: 1, rgb: 0x010203 },
    });
  });
});

describe("GraphNodeColors", () => {
  it("holds one reading until the theme changes", () => {
    themeStates("rgb(120, 82, 238)", "rgb(136, 136, 136)");
    const colors = new GraphNodeColors();
    const first = colors.current();

    document.body.style.setProperty(
      themeProperty.graphLiteratureNote,
      "rgb(0, 0, 255)",
    );

    expect(colors.current()).toBe(first);
    expect(first.literatureNote).toEqual({ a: 1, rgb: 0x7852ee });

    colors.invalidate();

    expect(colors.current().literatureNote).toEqual({ a: 1, rgb: 0x0000ff });
  });
});

describe("parseGraphColor", () => {
  it.each([
    ["rgb(1, 2, 3)", "1", { a: 1, rgb: 0x010203 }],
    ["rgba(0, 0, 255, 0.4)", "0.5", { a: 0.2, rgb: 0x0000ff }],
    ["rgb(120, 82, 238)", "", { a: 1, rgb: 0x7852ee }],
  ])("reads %s at opacity %s", (color, opacity, expected) => {
    expect(parseGraphColor(color, opacity)).toEqual(expected);
  });

  it("states no colour for a value with no channels to read", () => {
    expect(parseGraphColor("", "1")).toBeNull();
  });
});

describe("parseGraphColor through the browser's own reader", () => {
  /**
   * Stands in for a browser's canvas: it paints the values in `paints`, and
   * refuses every other value the way a browser does — by ignoring the
   * assignment, so `fillStyle` keeps what it held.
   */
  function stubPainter(paints: Record<string, number[]>): void {
    const table: Record<string, number[]> = { "#010203": [1, 2, 3, 255] };
    Object.assign(table, paints);
    let fillStyle = "";
    const painter = {
      get fillStyle() {
        return fillStyle;
      },
      set fillStyle(value: string) {
        if (value in table) fillStyle = value;
      },
      fillRect: vi.fn(),
      getImageData: () => ({ data: Uint8ClampedArray.from(table[fillStyle]!) }),
    };
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return painter;
        }
      },
    );
  }

  it("reads the bytes a syntax the browser keeps as written paints as", () => {
    stubPainter({ "oklch(0.7 0.1 200)": [0, 128, 255, 128] });

    const parsed = parseGraphColor("oklch(0.7 0.1 200)", "1");

    expect(parsed?.rgb).toBe(0x0080ff);
    expect(parsed?.a).toBeCloseTo(0.502, 3);
  });

  it("fades a painted colour by the element's opacity", () => {
    stubPainter({ "color(srgb 0 0.5 1)": [0, 128, 255, 255] });

    expect(parseGraphColor("color(srgb 0 0.5 1)", "0.5")).toEqual({
      a: 0.5,
      rgb: 0x0080ff,
    });
  });

  it("states no colour for a value the browser refuses", () => {
    stubPainter({});

    expect(parseGraphColor("not-a-colour", "1")).toBeNull();
  });
});

describe("stampNodeColors", () => {
  const colors = {
    literatureNote: { a: 1, rgb: 0x7852ee },
    citedWorkNode: { a: 0.5, rgb: 0x888888 },
  };

  it("colours Literature Notes and Cited Work Nodes and no other node", () => {
    const data: GraphData = {
      nodes: {
        "Literature/Doe 2024.md": graphNode(""),
        "@typo2024": graphNode("unresolved"),
        "Draft.md": graphNode(""),
        missing: graphNode("unresolved"),
      },
    };

    stampNodeColors(data, additions(), colors);

    expect(data.nodes["Literature/Doe 2024.md"]!.color).toBe(
      colors.literatureNote,
    );
    expect(data.nodes["@typo2024"]!.color).toBe(colors.citedWorkNode);
    expect(data.nodes["Draft.md"]!.color).toBeUndefined();
    expect(data.nodes["missing"]!.color).toBeUndefined();
  });

  it("colours a Literature Note no citation edge reaches", () => {
    const data: GraphData = {
      nodes: {
        "Literature/Doe 2024.md": graphNode(""),
        "Literature/Poe 2021.md": graphNode(""),
      },
    };

    stampNodeColors(
      data,
      {
        ...additions(),
        // Only Doe's note is cited; Poe's note is drawn on its own.
        resolvedLinks: { "Draft.md": { "Literature/Doe 2024.md": 1 } },
        literatureNotes: new Set([
          "Literature/Doe 2024.md",
          "Literature/Poe 2021.md",
        ]),
      },
      colors,
    );

    expect(data.nodes["Literature/Poe 2021.md"]!.color).toBe(
      colors.literatureNote,
    );
  });

  it("leaves a node the user's colour group already coloured", () => {
    const group = { a: 1, rgb: 0x00ff00 };
    const data: GraphData = {
      nodes: { "Literature/Doe 2024.md": graphNode("", group) },
    };

    stampNodeColors(data, additions(), colors);

    expect(data.nodes["Literature/Doe 2024.md"]!.color).toBe(group);
  });

  it("states no colour where the theme states none", () => {
    const data: GraphData = {
      nodes: { "Literature/Doe 2024.md": graphNode("") },
    };

    stampNodeColors(data, additions(), {
      literatureNote: null,
      citedWorkNode: null,
    });

    expect(data.nodes["Literature/Doe 2024.md"]!.color).toBeUndefined();
  });
});

describe("installNodeColors", () => {
  function fakeRenderer() {
    const handedOff: GraphData[] = [];
    const setData = (data: GraphData) => {
      handedOff.push(data);
      return "native";
    };
    const renderer = { setData } as unknown as GraphLeafMembers["renderer"];
    return { handedOff, native: setData, renderer };
  }

  it("colours every hand-off and passes it on, then restores the renderer", () => {
    themeStates("rgb(120, 82, 238)", "rgb(136, 136, 136)");
    const { renderer, handedOff, native } = fakeRenderer();
    const installation = { additions: additions() };
    const restore = installNodeColors(
      renderer,
      installation,
      new GraphNodeColors(),
    );

    const data: GraphData = {
      nodes: {
        "Literature/Doe 2024.md": graphNode(""),
        "Draft.md": graphNode(""),
      },
    };
    expect(renderer.setData(data)).toBe("native");

    expect(handedOff).toEqual([data]);
    expect(data.nodes["Literature/Doe 2024.md"]!.color).toEqual({
      a: 1,
      rgb: 0x7852ee,
    });
    expect(data.nodes["Draft.md"]!.color).toBeUndefined();

    restore[Symbol.dispose]();

    expect(renderer.setData).toBe(native);
  });
});
