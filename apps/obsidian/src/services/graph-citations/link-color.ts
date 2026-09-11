// The colour Graph Citations draws its own edges in: a tint substitution on each citation edge's line sprite, renewed on every data hand-off.

import type { GraphColor, GraphLink, GraphLinkSprite } from "obsidian";

import { disposable } from "@/lib/disposables";
import { themeProperty } from "@/lib/theme-hooks";

import type { GraphCitationAdditions } from "./adapter";
import { membersPresent, wrapMember } from "./install";
import type { GraphLeafMembers } from "./install";
import { readThemeColor } from "./node-color";
import type { ThemeColorRole } from "./node-color";

/**
 * The property a theme states the citation edge colour in, and the Obsidian
 * variable ZotLit falls back to: the purple a Literature Note's node takes, so
 * an edge and the node it reaches read as one family.
 */
const ROLE: ThemeColorRole = {
  property: themeProperty.graphCitationLink,
  fallback: "--color-purple",
};

/**
 * The citation edge colour as the theme states it now, read once and held
 * until the theme changes. Reading costs a style recalculation and every graph
 * leaf tints from the same reading, so the caller invalidates on `css-change`
 * rather than reading per frame.
 */
export class GraphLinkColor {
  #current: GraphColor | null | undefined;

  current(): GraphColor | null {
    if (this.#current === undefined) this.#current = readThemeColor(ROLE);
    return this.#current;
  }

  /** Drops the reading, so the next ask reads the theme again. */
  invalidate(): void {
    this.#current = undefined;
  }
}

export interface LinkColorsOptions {
  /** The citation edge colour, shared by every installed leaf. */
  color: GraphLinkColor;
  /**
   * Whether this graph's "Color citation links" row is on. Read per write, so
   * the render the row starts on a change already draws in the new state.
   */
  enabled: () => boolean;
}

/**
 * Draws the edges a Citation drew in ZotLit's own colour, and leaves every
 * other edge to Obsidian.
 *
 * The tint is substituted per edge rather than stated in the data: the graph
 * holds no per-edge colour at all, only a line sprite each frame writes the
 * one link colour to. An edge incident to the node the pointer rests on keeps
 * that write, so the native hover highlight reads as it always did.
 *
 * @param installation read at hand-off time, so each render tints the edges
 *   it drew.
 * @returns a Disposable that puts the renderer and every edge back. Empty when
 *   a build moved a member the tint reads; the graph then draws its edges
 *   natively.
 */
export function installLinkColors(
  members: GraphLeafMembers,
  installation: { readonly additions: GraphCitationAdditions },
  options: LinkColorsOptions,
): Disposable {
  const { renderer, viewType } = members;
  const present = membersPresent(
    "Graph renderer is missing an edge member; citation edges left native",
    {
      "renderer.links": Array.isArray(renderer.links),
      "renderer.getHighlightNode":
        typeof renderer.getHighlightNode === "function",
    },
    { viewType },
  );
  if (!present) return disposable(() => {});

  /**
   * What one frame writes to a citation edge's line. `null` leaves the write
   * as it came: the row is off, the theme states no colour, or the edge is
   * one of those the pointer's node highlights.
   */
  const tintOf = (link: GraphLink): number | null => {
    if (!options.enabled()) return null;
    const highlight = renderer.getHighlightNode!();
    if (highlight === link.source || highlight === link.target) return null;
    return options.color.current()?.rgb ?? null;
  };
  const isCitation = (link: GraphLink): boolean =>
    installation.additions.citationLinks[link.source.id]?.[link.target.id] !==
    undefined;

  let tints = new DisposableStack();
  const renew = (): void => {
    tints.dispose();
    tints = new DisposableStack();
    for (const link of renderer.links!) {
      if (isCitation(link)) tints.use(installTint(link, tintOf));
    }
  };
  const restores = new DisposableStack();
  restores.use(
    wrapMember(renderer, "setData", (setData) => (data) => {
      // After the hand-off: it is the hand-off that adds and removes edges.
      const drawn = setData.call(renderer, data);
      renew();
      return drawn;
    }),
  );
  restores.defer(() => tints.dispose());
  return restores;
}

/**
 * Substitutes the citation colour for whatever a frame writes to one edge's
 * line, for as long as the returned Disposable stands.
 *
 * The edge's `line` is read through an accessor rather than substituted once,
 * because an edge owns no sprite until the first frame that draws both its
 * nodes — many frames after the hand-off that named the edge — and owns a new
 * one each time it leaves the viewport and comes back. The accessor answers
 * the sprite of the moment, and the substitution moves to it; a sprite the
 * edge lets go of is left as it was built, which is what releasing on the
 * sprite's destruction amounts to.
 *
 * @returns a Disposable that leaves the edge holding its own sprite again.
 */
function installTint(
  link: GraphLink,
  tintOf: (link: GraphLink) => number | null,
): Disposable {
  let held = Object.hasOwn(link, "line");
  let sprite = link.line ?? null;
  let substituted = sprite && substituteTint(sprite, () => tintOf(link));
  Object.defineProperty(link, "line", {
    configurable: true,
    enumerable: true,
    get: () => sprite,
    set: (next: GraphLinkSprite | null) => {
      held = true;
      substituted?.[Symbol.dispose]();
      sprite = next ?? null;
      substituted = sprite && substituteTint(sprite, () => tintOf(link));
    },
  });
  return disposable(() => {
    substituted?.[Symbol.dispose]();
    delete link.line;
    if (held) link.line = sprite;
  });
}

/**
 * Substitutes what `tint` answers for whatever is written to one sprite's
 * `tint`, for as long as the returned Disposable stands.
 *
 * The substitution is an accessor on the sprite itself, so the edge answers
 * the one sprite the renderer built — anything that holds or compares it by
 * identity sees that same object — and a write is substituted for whichever
 * reference it arrives through. A sprite declares `tint` on its class, where
 * the setter that actually colours the line stands, so the accessor writes
 * through to it rather than holding a value of its own.
 *
 * @param tint what a `tint` write becomes; `null` lets the write through.
 * @returns a Disposable that leaves `tint` the sprite's class's again.
 */
function substituteTint(
  sprite: GraphLinkSprite,
  tint: () => number | null,
): Disposable {
  const declared = Object.getPrototypeOf(sprite) as object;
  Object.defineProperty(sprite, "tint", {
    configurable: true,
    enumerable: false,
    get: () => Reflect.get(declared, "tint", sprite) as number,
    set: (next: number) => {
      Reflect.set(declared, "tint", tint() ?? next, sprite);
    },
  });
  return disposable(() => {
    delete (sprite as Partial<GraphLinkSprite>).tint;
  });
}
