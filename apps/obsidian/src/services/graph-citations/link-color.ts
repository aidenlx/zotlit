// The colour Graph Citations draws its own edges in: a tint substitution on each citation edge's line sprite, renewed on every data hand-off.

import { around } from "monkey-around";
import type { GraphColor, GraphLink, GraphLinkSprite } from "obsidian";

import { disposable } from "@/lib/disposables";
import { themeProperty } from "@/lib/theme-hooks";

import type { GraphCitationAdditions } from "./adapter";
import { membersPresent } from "./install";
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
      "renderer.changed": typeof renderer.changed === "function",
    },
    { viewType },
  );
  if (!present) return disposable(() => {});

  /**
   * The colour a citation edge stands to be drawn in: the theme's, while the
   * row is on. `null` where the row is off or the theme states no colour,
   * which is the graph drawn in Obsidian's own link colour throughout.
   */
  const tint = (): number | null =>
    options.enabled() ? (options.color.current()?.rgb ?? null) : null;

  /**
   * What one frame writes to a citation edge's line. `null` leaves the write
   * as it came: there is no citation colour to draw, or the edge is one of
   * those the pointer's node highlights.
   */
  const tintOf = (link: GraphLink): number | null => {
    const substitute = tint();
    if (substitute === null) return null;
    const highlight = renderer.getHighlightNode!();
    if (highlight === link.source || highlight === link.target) return null;
    return substitute;
  };
  /**
   * Whether a Citation named this edge, in either direction. Obsidian keeps
   * both edges of a reciprocal pair but draws one line for the two: a link
   * whose source also holds a reverse link from its target draws nothing
   * where `source.id.localeCompare(target.id) < 0` (`app.js` 1.14.1,
   * `GraphLink.render`). So the citation A→B is the hidden line whenever
   * B links back to A and A sorts first, and the one line the reader sees is
   * B→A. Reading the pair either way puts the tint on whichever of the two
   * the frame draws.
   *
   * The reverse reading answers for a line the graph hides, so it stands only
   * while the graph holds the edge that hides it. A local graph showing
   * outgoing links alone keeps B→A and leaves the citation A→B out of the
   * render entirely (`app.js` 1.14.1, the forelink pass of the local
   * expansion); B→A is then the only line there is, and it is an ordinary
   * link.
   *
   * @param rendered the direction of every edge of this hand-off.
   */
  const isCitation = (
    link: GraphLink,
    rendered: ReadonlySet<string>,
  ): boolean => {
    const { citationLinks } = installation.additions;
    const source = link.source.id;
    const target = link.target.id;
    if (citationLinks[source]?.[target] !== undefined) return true;
    return (
      citationLinks[target]?.[source] !== undefined &&
      rendered.has(directionOf(target, source))
    );
  };

  let tints = new DisposableStack();
  /** The colour the last hand-off left the edges standing to be drawn in. */
  let drawn: number | null = null;
  /** The direction of every edge the last hand-off drew as a citation edge. */
  let citations = new Set<string>();
  /** @returns whether the hand-off changed which edges are citation edges. */
  const renew = (): boolean => {
    tints.dispose();
    tints = new DisposableStack();
    const links = renderer.links!;
    const rendered = new Set(
      links.map((link) => directionOf(link.source.id, link.target.id)),
    );
    const next = new Set<string>();
    for (const link of links) {
      if (!isCitation(link, rendered)) continue;
      next.add(directionOf(link.source.id, link.target.id));
      tints.use(installTint(link, tintOf));
    }
    const reclassified =
      next.size !== citations.size ||
      ![...next].every((direction) => citations.has(direction));
    citations = next;
    return reclassified;
  };
  const restores = new DisposableStack();
  restores.defer(
    around(renderer, {
      setData: (setData) => (data) => {
        // After the hand-off: it is the hand-off that adds and removes edges.
        const handedOff = setData.call(renderer, data);
        const reclassified = renew();
        // The row, the theme, and a citation added to or taken out of a note
        // that also links the same target the ordinary way, all change what an
        // edge is drawn in with no node and no edge changing, and a hand-off
        // that changes neither asks for no frame of its own (`app.js` 1.14.1,
        // `setData` calls `changed` only where one of them changed). So a graph
        // standing still would keep the colours it was last drawn in until
        // something else redrew it; the hand-off that changes them asks for that
        // frame itself.
        const next = tint();
        if (next !== drawn || reclassified) {
          drawn = next;
          renderer.changed!();
        }
        return handedOff;
      },
    }),
  );
  restores.defer(() => {
    tints.dispose();
    // Unchanged topology does not trigger a native redraw after teardown.
    renderer.changed!();
  });
  return restores;
}

/**
 * One edge's direction, as the edges of a hand-off are looked up by. A node id
 * is a vault path, a tag, or a Cited Work Node's citekey node, and none of the
 * three carries a newline, so the two ends stay told apart.
 */
function directionOf(source: string, target: string): string {
  return `${source}\n${target}`;
}

/**
 * Substitutes the citation colour for whatever a frame writes to one edge's
 * line, for as long as the returned Disposable stands.
 *
 * The edge's `line` is read through an accessor rather than substituted once,
 * because an edge owns no sprite until the first frame that draws both its
 * nodes — many frames after the hand-off that named the edge — and owns a new
 * one after every graphics teardown: `clearGraphics` destroys the sprite and
 * lets go of it, and the next frame's `initGraphics` builds another for the
 * same edge. A graph whose canvas is rebuilt goes through both, which is what
 * moving a graph leaf to a pop-out window does (`app.js` 1.14.1,
 * `GraphRenderer.onIframeLoad`). An edge that merely leaves the viewport keeps
 * the sprite it has and is hidden by a visibility flag. The accessor answers
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
