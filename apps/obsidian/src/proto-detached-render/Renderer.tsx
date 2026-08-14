// PROTOTYPE #743 — throwaway, delete after ticket resolution.
//
// One pure Preact component that renders a minimal pandoc inline-node run.
//
// PURITY CONTRACT: no hooks, no effects, no subscriptions, no portals — plain
// JSX from data, nothing else. That is the property the detached-render
// question turns on.

import type { ReactNode } from "react";

import type { Inline } from "./ast";

/** The #741 Entry Serial stand-in: a hardcoded superscript placeholder. */
const NOTE_PLACEHOLDER = "¹"; // ¹

function InlineNode({ node }: { node: Inline }): ReactNode {
  switch (node.t) {
    case "Str":
      return node.c;
    case "Space":
      return " ";
    case "Emph":
      return (
        <em>
          <InlineRun nodes={node.c} />
        </em>
      );
    case "Strong":
      return (
        <strong>
          <InlineRun nodes={node.c} />
        </strong>
      );
    case "Superscript":
      return (
        <sup>
          <InlineRun nodes={node.c} />
        </sup>
      );
    case "Subscript":
      return (
        <sub>
          <InlineRun nodes={node.c} />
        </sub>
      );
    case "Span": {
      const [[, classes], content] = [node.c[0], node.c[1]];
      return (
        <span className={classes.join(" ")}>
          <InlineRun nodes={content} />
        </span>
      );
    }
    case "Note":
      return <sup>{NOTE_PLACEHOLDER}</sup>;
    default:
      return null;
  }
}

/** Renders a run of pandoc inline nodes as plain JSX. */
export function InlineRun({ nodes }: { nodes: readonly Inline[] }): ReactNode {
  return (
    <>
      {nodes.map((node, i) => (
        <InlineNode key={i} node={node} />
      ))}
    </>
  );
}
