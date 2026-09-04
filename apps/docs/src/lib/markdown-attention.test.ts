import { defaultStringifier } from "fumadocs-core/mdx-plugins";
import type { LLMsOptions } from "fumadocs-core/mdx-plugins";
import { describe, expect, it } from "vitest";

import { stringifyAttention } from "./markdown-attention";

type Node = Parameters<NonNullable<LLMsOptions["stringify"]>>[0];

const text = (value: string) => ({ type: "text", value }) as const;
const code = (value: string) => ({ type: "inlineCode", value }) as const;
const strong = (...children: Node[]) => ({ type: "strong", children }) as const;
const emphasis = (...children: Node[]) =>
  ({ type: "emphasis", children }) as const;

/** Serializes one paragraph through the same stringifier the Markdown edition runs. */
function render(...children: Node[]): string {
  const stringify = defaultStringifier({
    // oxlint-disable-next-line max-params -- signature dictated by LLMsOptions.stringify
    stringify: (node, _parent, state, info) =>
      stringifyAttention(node, state, info),
  }) as unknown as (node: Node, ctx: undefined) => string;
  return stringify(
    { type: "root", children: [{ type: "paragraph", children }] } as Node,
    undefined,
  ).trim();
}

describe("stringifyAttention", () => {
  it.each([
    {
      name: "strong span before a full stop",
      children: [
        text("select "),
        strong(text("Install Add-on From File...")),
        text(". Choose"),
      ],
      expected: "select **Install Add-on From File...**. Choose",
    },
    {
      name: "strong span holding punctuation only",
      children: [text("Click the "), strong(text("+")), text(" (New) button")],
      expected: "Click the **+** (New) button",
    },
    {
      name: "emphasis span ending on a quote",
      children: [
        text("Obsidian shows "),
        emphasis(text('Failed to load plugin "zotlit"')),
        text(", and"),
      ],
      expected: 'Obsidian shows *Failed to load plugin "zotlit"*, and',
    },
    {
      name: "strong span ending on inline code",
      children: [
        text("shows as "),
        strong(text("Group "), code("{ID}")),
        text(" with the note"),
      ],
      expected: "shows as **Group `{ID}`** with the note",
    },
    {
      name: "strong span next to plain text",
      children: [text("plain "), strong(text("Bold")), text(". done")],
      expected: "plain **Bold**. done",
    },
  ])("keeps the opening marker literal: $name", ({ children, expected }) => {
    expect(render(...(children as Node[]))).toBe(expected);
  });
});
