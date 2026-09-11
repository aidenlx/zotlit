// Theme colors for literature-note group seeds and virtual Cited Work Nodes.

import { regex } from "arkregex";
import { around } from "monkey-around";
import type { GraphColor, GraphData } from "obsidian";

import { disposable } from "@/lib/disposables";
import { getLogger } from "@/lib/log";
import { themeProperty } from "@/lib/theme-hooks";

import type { GraphCitationAdditions } from "./adapter";
import type { GraphLeafMembers } from "./install";

const logger = getLogger("graph-citations");

/** A theme property and its fallback CSS variable or color value. */
export interface ThemeColorRole {
  property: string;
  fallback: string;
}

const ROLE = {
  citedWorkNode: {
    property: themeProperty.graphCitedWorkNode,
    fallback: "--text-faint",
  },
} as const satisfies Record<string, ThemeColorRole>;

/** The virtual-node fill; `null` where no fill is stated. */
export interface NodeColors {
  citedWorkNode: GraphColor | null;
}

/**
 * The virtual-node color as the theme states it, read once and held until the
 * theme changes. Reading costs a style recalculation, and every graph leaf
 * stamps from the same reading, so the caller invalidates on `css-change`
 * rather than reading per render.
 */
export class GraphNodeColors {
  #current: NodeColors | null = null;

  current(): NodeColors {
    return (this.#current ??= readNodeColors());
  }

  /** Reads the seed at insertion time; native groups keep their saved color. */
  literatureNoteGroupColor(): GraphColor {
    return readLiteratureNoteGroupColor();
  }

  /** Drops the reading, so the next ask reads the theme again. */
  invalidate(): void {
    this.#current = null;
  }
}

/**
 * @returns the virtual-node color as a throwaway probe element resolves it, the way
 *   Obsidian reads its own graph colours.
 */
export function readNodeColors(): NodeColors {
  return {
    citedWorkNode: readThemeColor(ROLE.citedWorkNode),
  };
}

/** @see docs/brand.md — light and dark ZotLit accent colors. */
function readLiteratureNoteGroupColor(): GraphColor {
  const rgb = document.body.classList.contains("theme-dark")
    ? 0xf0793f
    : 0xe8622c;
  return (
    readThemeColor({
      property: themeProperty.graphLiteratureNote,
      fallback: `#${rgb.toString(16)}`,
    }) ?? { a: 1, rgb }
  );
}

/**
 * Reads one role's colour off a throwaway probe element. The value is stated
 * on the element itself rather than in a ZotLit rule, so that no reading waits
 * on ZotLit's own stylesheet: Obsidian inserts a plugin's stylesheet after the
 * plugin's `onload`, and a graph that was already open is drawn while the
 * plugin loads — a rule-borne colour would read as the inherited text colour
 * there and stay stamped until the next theme change.
 *
 * A theme's property wins wherever it stands, since the fallback is reached
 * only where the theme states nothing at all.
 */
export function readThemeColor(role: ThemeColorRole): GraphColor | null {
  // A theme states the property on `body`, or on something `body` inherits it
  // from, which is also where the probe inherits it from.
  const stated = getComputedStyle(document.body).getPropertyValue(
    role.property,
  );
  const probe = document.body.appendChild(document.createElement("div"));
  const value = stated.trim() ? role.property : role.fallback;
  probe.style.color = value.startsWith("--") ? `var(${value})` : value;
  const { color, opacity } = getComputedStyle(probe);
  probe.remove();
  const parsed = parseGraphColor(color, opacity);
  if (!parsed) {
    logger.debug("Theme states no colour for a graph role; left native", {
      property: role.property,
      color,
    });
  }
  return parsed;
}

/**
 * Colors virtual Cited Work Nodes that carry no native color. Literature-note
 * files receive their colors through ordinary native groups.
 *
 * @param colors shared by identity across renders, as the renderer expects.
 */
export function stampNodeColors(
  data: GraphData,
  additions: GraphCitationAdditions,
  colors: NodeColors,
): void {
  for (const [id, node] of Object.entries(data.nodes)) {
    if (node.color) continue;
    const color = additions.citedWorkNodes.has(id)
      ? colors.citedWorkNode
      : null;
    if (color) node.color = color;
  }
}

/**
 * Colors virtual Cited Work Nodes on every data hand-off.
 *
 * @param installation read at hand-off time, so each render colours the nodes
 *   it drew.
 * @param colors read at hand-off time, so each render draws in the theme in
 *   force.
 * @returns a Disposable that puts the renderer back.
 */
export function installNodeColors(
  renderer: GraphLeafMembers["renderer"],
  installation: { readonly additions: GraphCitationAdditions },
  colors: GraphNodeColors,
): Disposable {
  return disposable(
    around(renderer, {
      setData: (setData) => (data) => {
        stampNodeColors(data, installation.additions, colors.current());
        return setData.call(renderer, data);
      },
    }),
  );
}

/** `rgb()` / `rgba()`, the legacy form a browser serializes a plain colour to. */
const RGB = regex(
  "^rgba?\\((?<r>\\d+),\\s*(?<g>\\d+),\\s*(?<b>\\d+)(?:,\\s*(?<a>\\d*\\.?\\d+))?\\)$",
);

/**
 * @param color a computed `color`. The `rgb()`/`rgba()` form a browser
 *   serializes a plain colour to is read straight; every other syntax it
 *   accepts — `oklch()`, the `color(srgb …)` a `color-mix()` computes to — is
 *   painted on a canvas and read back as bytes.
 * @param opacity the same element's computed `opacity`, which fades the colour
 *   the way it fades the element; a document that computes none reads as fully
 *   opaque, as Obsidian's own reader takes it.
 * @returns the colour in the shape a graph node carries, or `null` for a value
 *   the browser itself states no colour for.
 */
export function parseGraphColor(
  color: string,
  opacity: string,
): GraphColor | null {
  const channels = channelsOf(color.trim());
  if (!channels) return null;
  const fade = Number.parseFloat(opacity);
  return {
    a: channels.a * (Number.isFinite(fade) ? fade : 1),
    rgb: (channels.r << 16) | (channels.g << 8) | channels.b,
  };
}

interface Channels {
  r: number;
  g: number;
  b: number;
  a: number;
}

function channelsOf(color: string): Channels | null {
  const rgb = RGB.exec(color);
  if (!rgb) return paintedChannels(color);
  return {
    r: Number.parseInt(rgb.groups.r, 10),
    g: Number.parseInt(rgb.groups.g, 10),
    b: Number.parseInt(rgb.groups.b, 10),
    a: rgb.groups.a === undefined ? 1 : Number.parseFloat(rgb.groups.a),
  };
}

/** A value the browser refuses leaves `fillStyle` as it was, which this stands in for. */
const REFUSED = "#010203";

/**
 * Hands the value to the browser's own colour reader: a 1×1 canvas paints
 * whatever syntax it accepts, and the painted pixel reads back as bytes.
 *
 * @returns the bytes `color` paints as, or `null` where the browser refuses
 *   the value or the document offers no canvas to paint it on.
 */
function paintedChannels(color: string): Channels | null {
  if (typeof OffscreenCanvas === "undefined") return null;
  const painter = new OffscreenCanvas(1, 1).getContext("2d", {
    willReadFrequently: true,
  });
  if (!painter) return null;
  painter.fillStyle = REFUSED;
  painter.fillStyle = color;
  if (painter.fillStyle === REFUSED) return null;
  painter.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = painter.getImageData(0, 0, 1, 1).data;
  return { r: r!, g: g!, b: b!, a: a! / 255 };
}
