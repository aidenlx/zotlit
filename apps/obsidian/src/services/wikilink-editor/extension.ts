// The CodeMirror side of the Wikilink Editor Treatment: one replace decoration
// per Literature Note wikilink in the visible ranges, carrying the Citation
// Display Text and everything Obsidian's own rendering would have supplied, so
// click, hover, drag, and the context menu keep running Obsidian's handlers.

import { syntaxTree, tokenClassNodeProp } from "@codemirror/language";
import { RangeSetBuilder, StateEffect } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import { Decoration, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet, EditorView, ViewUpdate } from "@codemirror/view";
import { editorInfoField, livePreviewState } from "obsidian";

import { livePreviewOf } from "@/lib/editor-decoration";
import type { DocRange } from "@/lib/editor-decoration";
import type { LiteratureNoteTarget } from "@/lib/wikilink-citation";

import { wikilinkDecorations } from "./decorate";
import type { WikilinkDecoration } from "./decorate";
import { scanWikilinks } from "./scan";
import type { TokenNode } from "./scan";
import "./style.css";

/** The plugin's own class on every display widget, and the styling hook. */
const WIKILINK_CLASS = "zt-wikilink-citation";

/**
 * Obsidian's own link-text class. Its live-preview click gate looks for it on
 * the event target's ancestor chain, and nothing of Obsidian's wraps a plugin
 * widget, so the widget carries it itself.
 *
 * @see docs/research/wikilink-display-decoration-interaction.md — section 2.5
 */
const UNDERLINE_CLASS = "cm-underline";

export interface WikilinkEditorHandlers {
  /**
   * The Literature Note `linkpath` names, seen from the document at
   * `sourcePath`, or null when it names none.
   */
  literatureNote: (
    linkpath: string,
    sourcePath: string,
  ) => LiteratureNoteTarget | null;
  /**
   * Read once per decoration build, so the settings behind it reach the
   * builder without the extension being registered again.
   *
   * @see ./decorate.ts — `WikilinkDisplayContext.fragmentlessDisplay`
   */
  fragmentlessDisplay: () => boolean;
}

/**
 * Dispatched by the wikilink editor service whenever something outside the
 * document changed what these decorations should say — a Literature Note
 * appearing, losing its Citation Key Property, or the settings that gate
 * fragment-less display. Every such invalidation is coarse, so this one effect
 * asks for a rebuild rather than naming what it touched.
 */
export const wikilinkDecorationsChanged = StateEffect.define<void>();

/**
 * Replaces the inner text of each Literature Note wikilink with its Citation
 * Display Text in Live Preview.
 *
 * The decorations come from a view plugin, which the CodeMirror provisioning
 * rule allows because a wikilink never crosses a line and so no replacement
 * changes the block structure. Precedence stays default: nothing Obsidian draws
 * on a wikilink can wrap the replacement whatever the precedence, because the
 * exclusion is geometric — its marks cover exactly the replaced range — so the
 * widget supplies those classes itself instead.
 *
 * @see docs/research/wikilink-display-decoration-interaction.md — sections 1, 7
 */
export function wikilinkEditorExtension(
  handlers: WikilinkEditorHandlers,
): Extension {
  return ViewPlugin.fromClass(
    class WikilinkEditorPlugin {
      decorations: DecorationSet = Decoration.none;
      /** The tree the current set was built from, which gates the rebuild. */
      #tree;

      constructor(view: EditorView) {
        this.#tree = syntaxTree(view.state);
        this.decorations = buildDecorations(view, handlers);
      }

      update(update: ViewUpdate): void {
        const tree = syntaxTree(update.state);
        // The stream parse stops just past the viewport, so a tree shorter than
        // the viewport has no nodes over part of it — rebuilding from it would
        // drop every link there and bring it back a tick later. Obsidian
        // freezes for the same reason during IME composition and while the
        // mouse is down, so a drag-selection never moves the text under the
        // pointer. In all three the mapped set stands in until the next update.
        if (
          tree.length < update.view.viewport.to ||
          update.view.composing ||
          update.view.plugin(livePreviewState)?.mousedown
        ) {
          if (update.docChanged) {
            this.decorations = this.decorations.map(update.changes);
          }
          return;
        }
        if (
          tree !== this.#tree ||
          update.docChanged ||
          update.viewportChanged ||
          // A widget hides the link's source, so every selection and focus
          // change decides again which links show raw text.
          update.selectionSet ||
          update.focusChanged ||
          livePreviewOf(update.state) !== livePreviewOf(update.startState) ||
          update.transactions.some((tr) =>
            tr.effects.some((effect) => effect.is(wikilinkDecorationsChanged)),
          )
        ) {
          this.#tree = tree;
          this.decorations = buildDecorations(update.view, handlers);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

/**
 * One decorated wikilink, shown as its Citation Display Text.
 *
 * The element carries exactly what Obsidian's own rendering would have put on
 * the replaced text: the `cm-*` classes of the token it stands for, the class
 * the click gate reads, and the `draggable` attribute that both clears the
 * structural gate around replaced widgets and gives drag something to latch
 * onto. No event handler of the plugin's runs — every gesture reaches
 * Obsidian's own handlers, which resolve the link from the document position
 * rather than from the DOM.
 *
 * @see docs/research/wikilink-display-decoration-interaction.md — sections 2, 2.5
 */
class CitationDisplayWidget extends WidgetType {
  readonly #text;
  readonly #className;

  constructor(text: string, tokenClasses: readonly string[]) {
    super();
    this.#text = text;
    this.#className = [
      ...tokenClasses.map((name) => `cm-${name}`),
      UNDERLINE_CLASS,
      WIKILINK_CLASS,
    ].join(" ");
  }

  eq(other: CitationDisplayWidget): boolean {
    return other.#text === this.#text && other.#className === this.#className;
  }

  toDOM(view: EditorView): HTMLElement {
    const element = view.dom.ownerDocument.createElement("span");
    element.className = this.#className;
    element.tabIndex = -1;
    element.draggable = true;
    element.textContent = this.#text;
    return element;
  }
}

function buildDecorations(
  view: EditorView,
  handlers: WikilinkEditorHandlers,
): DecorationSet {
  const { state } = view;
  // Source mode installs none of Obsidian's live-preview extensions and shows
  // raw text throughout; the treatment follows it.
  if (!livePreviewOf(state)) return Decoration.none;

  const sourcePath = state.field(editorInfoField, false)?.file?.path ?? "";
  const context = {
    literatureNote: (linkpath: string) =>
      handlers.literatureNote(linkpath, sourcePath),
    fragmentlessDisplay: handlers.fragmentlessDisplay(),
    selection: view.hasFocus ? state.selection.ranges : [],
  };

  const builder = new RangeSetBuilder<Decoration>();
  for (const range of visibleLineRanges(view)) {
    const spans = scanWikilinks(tokenNodes(state, range));
    for (const decoration of wikilinkDecorations(spans, context)) {
      builder.add(decoration.from, decoration.to, replacement(decoration));
    }
  }
  return builder.finish();
}

function replacement(decoration: WikilinkDecoration): Decoration {
  return Decoration.replace({
    widget: new CitationDisplayWidget(decoration.text, decoration.tokenClasses),
  });
}

/**
 * The visible ranges widened to whole lines and merged, so a link straddling a
 * range edge is scanned once and in full. Wikilinks never cross a line, so
 * whole lines are enough, and the merge keeps the ranges disjoint and ordered —
 * which is what {@link RangeSetBuilder} requires of the additions built from
 * them.
 */
function visibleLineRanges(view: EditorView): DocRange[] {
  const { doc } = view.state;
  const ranges: DocRange[] = [];
  for (const range of view.visibleRanges) {
    const from = doc.lineAt(range.from).from;
    const to = doc.lineAt(range.to).to;
    const last = ranges.at(-1);
    if (last !== undefined && from <= last.to) last.to = Math.max(last.to, to);
    else ranges.push({ from, to });
  }
  return ranges;
}

/**
 * The token nodes of one region, in document order. Line-class nodes are left
 * out: they span a whole line and would break the node adjacency the scan reads
 * conceal groups from.
 */
function tokenNodes(state: EditorState, range: DocRange): TokenNode[] {
  const nodes: TokenNode[] = [];
  syntaxTree(state).iterate({
    from: range.from,
    to: range.to,
    enter(node) {
      const classes = node.type.prop(tokenClassNodeProp);
      if (classes === undefined) return;
      nodes.push({
        from: node.from,
        to: node.to,
        classes: classes.split(" "),
        text: state.doc.sliceString(node.from, node.to),
      });
    },
  });
  return nodes;
}
