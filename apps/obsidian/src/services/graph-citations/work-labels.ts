// Owns per-node Work Label graphics across Obsidian's lazy graphics lifecycle.

import { around } from "monkey-around";
import type {
  GraphDrawnNode,
  GraphTextContainer,
  GraphTextDisplay,
  GraphTextStyle,
} from "obsidian";

import type { WorkLabel } from "@/lib/item-summary";
import { getLogger } from "@/lib/log";

import type { GraphLeafMembers } from "./install";
import { workLabelTitleAlpha } from "./work-label-zoom";

const logger = getLogger("graph-citations");
const LABEL_WIDTH = 240;

/** Retains exactly the drawn keys, including unreadable hits until invalidation. */
export function refreshWorkLabels(
  held: ReadonlyMap<string, WorkLabel | null>,
  keys: ReadonlySet<string>,
  read: (key: string) => WorkLabel | null,
): Map<string, WorkLabel | null> {
  return new Map(
    Array.from(keys, (key) => [
      key,
      held.has(key) ? held.get(key)! : read(key),
    ]),
  );
}

interface TextSprite extends GraphTextDisplay {
  text: string;
  width: number;
  height: number;
  resolution: number;
  anchor: { set(x: number, y: number): void };
  style: GraphTextStyle;
}
interface GraphPixi {
  Container: new () => GraphTextContainer;
  Text: new (text: string, style: GraphTextStyle) => TextSprite;
}
interface HeldNode {
  label: WorkLabel;
  restore: () => void;
  container: GraphTextContainer | null;
}

export class WorkLabelGraphics implements Disposable {
  readonly #members;
  readonly #held = new Map<GraphDrawnNode, HeldNode>();
  #warnedFade = false;

  constructor(members: GraphLeafMembers) {
    this.#members = members;
  }

  /** Receives resident text only; node builders perform no metadata reads. */
  update(labels: ReadonlyMap<string, WorkLabel>): void {
    const { renderer } = this.#members;
    if (
      !Array.isArray(renderer.nodes) ||
      typeof renderer.changed !== "function"
    ) {
      if (labels.size)
        logger.warn("Graph Work Label members unavailable; left native", {
          nodes: Array.isArray(renderer.nodes),
          changed: typeof renderer.changed,
        });
      return;
    }
    const live = new Set(renderer.nodes);
    for (const [node, held] of this.#held) {
      const label = labels.get(node.id);
      if (
        !live.has(node) ||
        !label ||
        label.byline !== held.label.byline ||
        label.title !== held.label.title
      ) {
        this.#restore(node, held);
      }
    }
    for (const node of renderer.nodes) {
      const label = labels.get(node.id);
      if (!label || this.#held.has(node)) continue;
      if (
        typeof node.initGraphics !== "function" ||
        typeof node.clearGraphics !== "function" ||
        typeof node.getTextStyle !== "function"
      ) {
        logger.warn("Graph node graphics members unavailable; left native", {
          nodeId: node.id,
        });
        continue;
      }
      const held: HeldNode = { label, restore: () => {}, container: null };
      held.restore = around(node, {
        initGraphics: (native) => () => {
          const built = native!.call(node);
          if (built) this.#replace(node, held);
          return built;
        },
      });
      this.#held.set(node, held);
      if (node.text) this.#replace(node, held);
    }
    renderer.changed();
  }

  #replace(node: GraphDrawnNode, held: HeldNode): void {
    const native = node.text;
    if (!native || native === held.container) return;
    let container: GraphTextContainer | null = null;
    try {
      const { renderer } = this.#members;
      if (
        typeof renderer.getHighlightNode !== "function" ||
        typeof renderer.scale !== "number" ||
        !Number.isFinite(renderer.scale) ||
        renderer.scale <= 0
      )
        throw new Error("Work Label zoom members unavailable");
      const win = renderer.containerEl.ownerDocument.defaultView;
      const pixi = (win as unknown as { PIXI?: GraphPixi } | null)?.PIXI;
      if (
        !pixi ||
        typeof pixi.Container !== "function" ||
        typeof pixi.Text !== "function" ||
        !native.parent ||
        typeof native.parent.addChild !== "function" ||
        typeof native.parent.removeChild !== "function" ||
        typeof native.destroy !== "function" ||
        !native.scale ||
        typeof native.scale.set !== "function"
      ) {
        throw new Error("Work Label PIXI or native text members unavailable");
      }
      container = makeLabel(pixi, {
        style: node.getTextStyle!(),
        label: held.label,
        titleAlpha: () => {
          const fade = renderer.fTextShowMult;
          if (!Number.isFinite(fade) && !this.#warnedFade) {
            this.#warnedFade = true;
            logger.warn("Graph text fade term unavailable; using zero", {
              member: "fTextShowMult",
              value: fade,
            });
          }
          return workLabelTitleAlpha(
            renderer.scale!,
            fade,
            renderer.getHighlightNode!() === node,
          );
        },
        failedStyle: (error) => {
          logger.warn(
            "Graph Work Label style refresh failed; restoring native text",
            { nodeId: node.id, error },
          );
          // Native render still holds this text object until it returns.
          queueMicrotask(() => {
            if (this.#held.get(node) !== held || node.text !== held.container)
              return;
            this.#restore(node, held);
            this.#members.renderer.changed?.();
          });
        },
      });
      container.x = native.x;
      container.y = native.y;
      container.alpha = native.alpha;
      container.visible = native.visible;
      container.zIndex = native.zIndex;
      container.eventMode = native.eventMode;
      container.scale.set(native.scale.x, native.scale.y);
      const parent = native.parent;
      parent.addChild(container);
      parent.removeChild(native);
      node.text = container;
      held.container = container;
      native.destroy();
    } catch (error) {
      if (container && node.text !== container) container.destroy();
      logger.warn("Graph Work Label graphics failed; left native", {
        nodeId: node.id,
        error,
      });
    }
  }

  #restore(node: GraphDrawnNode, held: HeldNode): void {
    held.restore();
    this.#held.delete(node);
    if (node.text && node.text === held.container) {
      try {
        node.clearGraphics!();
        node.initGraphics!();
      } catch (error) {
        logger.warn("Graph native text restoration failed", {
          nodeId: node.id,
          error,
        });
      }
    }
  }

  [Symbol.dispose](): void {
    for (const [node, held] of this.#held) this.#restore(node, held);
  }
}

/** PIXI measures each candidate in the actual font, including CJK glyph widths. */
function fitLine(sprite: TextSprite, value: string): void {
  sprite.text = value;
  if (sprite.width <= LABEL_WIDTH) return;
  const characters = Array.from(value);
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    sprite.text = `${characters.slice(0, middle).join("")}…`;
    if (sprite.width <= LABEL_WIDTH) low = middle;
    else high = middle - 1;
  }
  sprite.text = `${characters.slice(0, low).join("")}…`;
}

function makeLabel(
  pixi: GraphPixi,
  {
    style,
    label,
    failedStyle,
    titleAlpha,
  }: {
    style: GraphTextStyle;
    label: WorkLabel;
    failedStyle: (error: unknown) => void;
    titleAlpha: () => number;
  },
): GraphTextContainer {
  using rollback = new DisposableStack();
  const container = new pixi.Container();
  const destroy = container.destroy.bind(container);
  rollback.defer(() =>
    destroy({ children: true, texture: true, baseTexture: true }),
  );
  if (
    typeof container.addChild !== "function" ||
    typeof container.updateTransform !== "function" ||
    typeof container.scale?.set !== "function"
  )
    throw new Error("Work Label container members unavailable");
  const first = new pixi.Text("", style);
  container.addChild(first);
  const second = new pixi.Text("", style);
  container.addChild(second);
  for (const line of [first, second]) {
    if (
      typeof line.anchor?.set !== "function" ||
      typeof line.width !== "number"
    )
      throw new Error("Work Label text members unavailable");
    line.anchor.set(0.5, 0);
    line.resolution = 2;
    line.eventMode = "none";
  }
  second.alpha = titleAlpha();
  const updateTransform = container.updateTransform.bind(container);
  container.updateTransform = () => {
    // PIXI visits visible children only; update alpha before child transforms.
    second.alpha = titleAlpha();
    updateTransform();
  };
  const applyStyle = (next: GraphTextStyle): void => {
    if (
      !Number.isFinite(next.fontSize) ||
      !next.fontFamily ||
      next.fill === undefined
    )
      throw new Error("Work Label text style unavailable");
    const base: GraphTextStyle = {
      fontFamily: next.fontFamily,
      fontSize: next.fontSize,
      fontWeight: "600",
      fill: next.fill,
      wordWrap: false,
      align: "center",
    };
    first.style = base;
    second.style = {
      ...base,
      fontSize: next.fontSize * 0.85,
      fontWeight: "400",
    };
    fitLine(first, label.byline);
    fitLine(second, label.title);
    second.y = first.height + 2;
  };
  applyStyle(style);
  // Native render assigns `text.style` on theme/font changes.
  Object.defineProperty(container, "style", {
    configurable: true,
    set: (next: GraphTextStyle) => {
      try {
        applyStyle(next);
      } catch (error) {
        failedStyle(error);
      }
    },
  });
  const lifetime = rollback.move();
  container.destroy = () => lifetime.dispose();
  return container;
}
