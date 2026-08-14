// PROTOTYPE #743 — throwaway, delete after ticket resolution.
//
// A pure recursive AST -> DOM traversal, hand-written with no Preact
// involved. Produces the identical DOM shape InlineRun renders (Renderer.tsx):
// same tags, same classes, same text — the baseline the adapter is measured
// against.

import { stats } from "./adapter";
import type { Inline } from "./ast";

/** The #741 Entry Serial stand-in: a hardcoded superscript placeholder. */
const NOTE_PLACEHOLDER = "¹"; // ¹

function appendNode(doc: Document, parent: Node, node: Inline): void {
  switch (node.t) {
    case "Str":
      parent.appendChild(doc.createTextNode(node.c));
      return;
    case "Space":
      parent.appendChild(doc.createTextNode(" "));
      return;
    case "Emph": {
      const em = doc.createElement("em");
      appendRun(doc, em, node.c);
      parent.appendChild(em);
      return;
    }
    case "Strong": {
      const strong = doc.createElement("strong");
      appendRun(doc, strong, node.c);
      parent.appendChild(strong);
      return;
    }
    case "Superscript": {
      const sup = doc.createElement("sup");
      appendRun(doc, sup, node.c);
      parent.appendChild(sup);
      return;
    }
    case "Subscript": {
      const sub = doc.createElement("sub");
      appendRun(doc, sub, node.c);
      parent.appendChild(sub);
      return;
    }
    case "Span": {
      const [[, classes], content] = [node.c[0], node.c[1]];
      const span = doc.createElement("span");
      if (classes.length > 0) span.className = classes.join(" ");
      appendRun(doc, span, content);
      parent.appendChild(span);
      return;
    }
    case "Note": {
      const sup = doc.createElement("sup");
      sup.appendChild(doc.createTextNode(NOTE_PLACEHOLDER));
      parent.appendChild(sup);
      return;
    }
    default:
      return;
  }
}

function appendRun(
  doc: Document,
  parent: Node,
  nodes: readonly Inline[],
): void {
  for (const node of nodes) appendNode(doc, parent, node);
}

/** Renders a run of pandoc inline nodes by hand-written DOM traversal. */
export function renderNative(
  nodes: readonly Inline[],
  doc: Document,
): HTMLElement {
  const span = doc.createElement("span");
  appendRun(doc, span, nodes);
  stats.nativeRenders++;
  return span;
}
