// The one rendering of a formatted inline flow, shared by every surface that shows citations.

import type { ReactNode } from "react";
import { createElement, isValidElement } from "react";
import { createRoot } from "react-dom/client";

import { getLogger } from "@/lib/log";
import { themeHook } from "@/lib/theme-hooks";
import { tooltipAttrs } from "@/lib/utils";

import type { Blocks, Inline, Inlines, QuoteType } from "./ast";

const logger = getLogger(["pandoc", "renderer"]);

export interface InlineContentProps {
  /** The formatted flow, as the engine handed it over. */
  nodes: Inlines;
  /**
   * One slot per work the citation names, in the order it names them; a slot is
   * `undefined` where the bibliography rendered no entry for that work. Left
   * unset by a flow that is not a citation's, which drops any `Note` it holds.
   */
  serials?: readonly (number | undefined)[];
  /**
   * Whether a link target reaches the DOM as an anchor. A surface that inserts
   * into an anchor of its own suppresses them, since nesting one anchor in
   * another is invalid; the link's own content still shows, as plain text the
   * surrounding anchor carries.
   * @default "render"
   */
  links?: "render" | "suppress";
}

/**
 * Show one formatted inline flow — a rendered citation, a bibliography entry,
 * or either one's Entry Marker.
 *
 * The component owns no wrapper: it renders the flow's own elements and nothing
 * around them, so each surface keeps the element and the classes it already
 * inserts into. It is pure by contract — props in, elements out, no hooks, no
 * subscriptions, no portals — which is what lets the raw-DOM surfaces render it
 * detached and never unmount it. Text reaches the DOM as text alone: nothing a
 * style or an item field carries is ever read as markup.
 */
export function InlineContent(props: InlineContentProps) {
  return <>{renderFlow(props.nodes, contextOf(props))}</>;
}

/**
 * Render inline content into a container that no React tree above it owns, for
 * the reading-view and editor surfaces that build their DOM by hand.
 *
 * The adapter walks the flow {@link InlineContent} renders and hands React the
 * commit alone, which populates `container` before this returns, so the caller
 * hands the container straight back to Obsidian. That population is asserted
 * rather than assumed: a container left empty where the flow had something to
 * show means the render deferred its commit, and every surface is handing
 * Obsidian an element it never fills. A flow that shows nothing — no nodes, or
 * none the renderer keeps — leaves the container empty on its own and passes.
 * The root is then left alone: the component holds no effects to clean up, and
 * the container dies with the DOM its surface inserted it into.
 */
export function renderInlineContent(
  container: Element,
  props: InlineContentProps,
): void {
  const flow = renderFlow(props.nodes, contextOf(props));
  createRoot(container).render(<>{flow}</>);
  if (flow.length === 0 || container.hasChildNodes()) return;
  logger.error("Detached render left the container empty", {
    inlines: props.nodes.length,
  });
}

interface Context {
  serials: readonly (number | undefined)[] | undefined;
  links: "render" | "suppress";
}

/** The one reading of the props both rendering paths walk a flow under. */
function contextOf({ serials, links = "render" }: InlineContentProps): Context {
  return { serials, links };
}

/**
 * The elements pandoc's own HTML writer gives these constructors. Every walk of
 * a flow wraps these six under this one table — the clipboard serializer as
 * much as the renderer — so a formatted entry reads the same wherever it lands.
 */
export const WRAPPER_TAGS = {
  Emph: "em",
  Strong: "strong",
  Underline: "u",
  Strikeout: "del",
  Superscript: "sup",
  Subscript: "sub",
} as const;

/** The characters a quotation reaches the reader as, by its own quote type. */
export const QUOTE_MARKS = {
  SingleQuote: ["‘", "’"],
  DoubleQuote: ["“", "”"],
} as const satisfies Record<QuoteType["t"], readonly [string, string]>;

/**
 * The spans citeproc lays an entry out with. They stand for a line break or a
 * column in the style's own layout, which an inline flow has nowhere to put, so
 * each hands its content over and leaves one space where it stood.
 */
export const DISPLAY_CLASSES = new Set([
  "csl-block",
  "csl-indent",
  "csl-left-margin",
  "csl-right-inline",
]);

/**
 * The schemes a formatted link is followed under — a DOI, a URL, or an address.
 * A target under any other scheme carries no CSL semantic, and an active one
 * (`javascript:` above all) never reaches the DOM.
 */
const LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/** The slot of a cited work the bibliography rendered no entry for. */
const NO_ENTRY = "⚠";

/**
 * Track the separators a flow being written owes, so every walk of a flow
 * spaces its parts the one way.
 *
 * A flow reads as one run of text: the separators between two parts collapse
 * into a single space, a leading one is dropped, and a part that starts after a
 * display span is owed a space whether or not the flow already carries one
 * there.
 *
 * @param append how one written node reaches the flow being built.
 */
export function flowWriter<T>(append: (node: T | string) => void) {
  /** Whether the flow already ends in a separator, so none is owed. */
  let spaced = true;
  /** Whether a display span just ended, so the next content starts a part. */
  let boundary = false;

  const separate = (): void => {
    if (spaced) return;
    append(" ");
    spaced = true;
  };

  const add = (node: T | string): void => {
    if (boundary) separate();
    boundary = false;
    append(node);
    spaced = false;
  };

  const endPart = (): void => {
    boundary = true;
  };

  return { separate, add, endPart };
}

/**
 * Walk one flow into the nodes that show it.
 *
 * A constructor that stands for an element renders as that element; one that
 * stands for a layout ({@link DISPLAY_CLASSES}, `Cite`, a link that stays
 * behind) hands its own content to this same flow, so what it wrapped keeps
 * reading as one run of text.
 */
function renderFlow(nodes: Inlines, context: Context): ReactNode[] {
  const flow: ReactNode[] = [];
  const { separate, add, endPart } = flowWriter<ReactNode>((node) => {
    flow.push(node);
  });
  let key = 0;

  function walk(inlines: Inlines): void {
    for (const inline of inlines) {
      switch (inline.t) {
        case "Str":
          add(inline.c);
          break;
        case "Space":
        case "SoftBreak":
          separate();
          break;
        case "LineBreak":
          add(<br key={key++} />);
          break;
        case "Emph":
        case "Strong":
        case "Underline":
        case "Strikeout":
        case "Superscript":
        case "Subscript":
          add(
            createElement(
              WRAPPER_TAGS[inline.t],
              { key: key++ },
              renderFlow(inline.c, context),
            ),
          );
          break;
        case "SmallCaps":
          add(
            <span key={key++} className="zt:[font-variant:small-caps]">
              {renderFlow(inline.c, context)}
            </span>,
          );
          break;
        case "Quoted": {
          const [open, close] = QUOTE_MARKS[inline.c[0].t];
          add(open);
          walk(inline.c[1]);
          add(close);
          break;
        }
        case "Code": {
          const [, source] = inline.c;
          add(<code key={key++}>{source}</code>);
          break;
        }
        case "Math": {
          const [, source] = inline.c;
          add(source);
          break;
        }
        case "Cite": {
          const [, content] = inline.c;
          walk(content);
          break;
        }
        case "Image": {
          const [, alt] = inline.c;
          walk(alt);
          break;
        }
        case "Span": {
          const [[, classes], content] = inline.c;
          const display = classes.some((name) => DISPLAY_CLASSES.has(name));
          if (display) separate();
          walk(content);
          if (display) endPart();
          break;
        }
        case "Link": {
          const [, children, [url, title]] = inline.c;
          if (context.links === "suppress") {
            add(plainText(children, context));
            break;
          }
          const href = linkHref(url);
          if (href === null) {
            walk(children);
            break;
          }
          add(
            <a key={key++} href={href} {...(title ? tooltipAttrs(title) : {})}>
              {renderFlow(children, context)}
            </a>,
          );
          break;
        }
        case "Note": {
          const { serials } = context;
          if (!serials?.length) {
            logger.debug("Dropped a note with no serial to stand for it", {
              inline: inline.t,
            });
            break;
          }
          add(
            <sup key={key++} className={themeHook.entrySerial}>
              {serials.map((serial) => serial ?? NO_ENTRY).join(",")}
            </sup>,
          );
          break;
        }
        case "RawInline":
          logger.debug("Dropped an inline the renderer cannot show", {
            inline: inline.t,
            format: inline.c[0],
          });
          break;
      }
    }
  }

  walk(nodes);
  return flow;
}

/**
 * Whether a flow holds a note — the footnote a note-class Citation and
 * References Style writes a citation as, which no surface of a document can
 * show and an Entry Serial run stands in for.
 *
 * It is the one signal that puts a document on Entry Serials: a surface reads
 * it off what the engine rendered, rather than off the style that rendered it.
 */
export function holdsNote(nodes: Inlines): boolean {
  return nodes.some((inline) => {
    switch (inline.t) {
      case "Note":
        return true;
      case "Emph":
      case "Strong":
      case "Underline":
      case "Strikeout":
      case "Superscript":
      case "Subscript":
      case "SmallCaps":
        return holdsNote(inline.c);
      case "Quoted":
      case "Cite":
      case "Link":
      case "Image":
      case "Span":
        return holdsNote(inline.c[1]);
      default:
        return false;
    }
  });
}

/**
 * The text of the notes one flow holds, as one inline flow — what a note-class
 * style wrote a citation as, subsequent forms and locators included, which the
 * Citation Popover shows whole where the surfaces show serials in its place.
 *
 * A note holds blocks, which an inline flow has nowhere to put: each paragraph
 * hands its own inlines over and the next one starts after a space, so the note
 * reads as the one run of text the shared renderer takes.
 *
 * A note a reader wrote themselves, in a citation prefix, reads as part of that
 * text — the accepted limitation the Entry Serial run carries too, since a flow
 * says nothing about who wrote the note it holds.
 *
 * @returns the note text, empty for a flow holding no note — which is every
 *   citation a style writes inline.
 */
export function noteContent(nodes: Inlines): Inlines {
  const flow: Inline[] = [];

  function addBlocks(blocks: Blocks): void {
    for (const block of blocks) {
      switch (block.t) {
        case "Plain":
        case "Para":
          if (flow.length > 0) flow.push({ t: "Space" });
          flow.push(...block.c);
          break;
        default:
          logger.debug("Dropped a note block that reads as no inline flow", {
            block: block.t,
          });
      }
    }
  }

  function walk(inlines: Inlines): void {
    for (const inline of inlines) {
      switch (inline.t) {
        case "Note":
          addBlocks(inline.c);
          break;
        case "Emph":
        case "Strong":
        case "Underline":
        case "Strikeout":
        case "Superscript":
        case "Subscript":
        case "SmallCaps":
          walk(inline.c);
          break;
        case "Quoted":
        case "Cite":
        case "Link":
        case "Image":
        case "Span":
          walk(inline.c[1]);
          break;
        default:
          break;
      }
    }
  }

  walk(nodes);
  return flow;
}

/**
 * The text one flow reads as, for a destination that takes no elements at all —
 * an Entry Marker written beside plain text, above all.
 */
export function inlineText(nodes: Inlines): string {
  return plainText(nodes, contextOf({ nodes }));
}

/**
 * The text one flow reads as, with every element it would render left out —
 * how a link shows its content where the surface suppresses anchors, since the
 * anchor that surface inserts into carries the text as its own.
 */
function plainText(inlines: Inlines, context: Context): string {
  return textOf(renderFlow(inlines, context));
}

/** The text a rendered node holds, gathered from the nodes it wraps. */
function textOf(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) {
    return textOf((node.props as { children?: ReactNode }).children);
  }
  return "";
}

/**
 * A target is absolute here or nowhere: a fragment or a relative path resolves
 * against a document the surface has none of, and a destination outside the
 * vault has none of either.
 *
 * @returns the target when it is followable, `null` otherwise.
 */
export function linkHref(url: string): string | null {
  const target = URL.parse(url);
  return target && LINK_SCHEMES.has(target.protocol) ? url : null;
}
