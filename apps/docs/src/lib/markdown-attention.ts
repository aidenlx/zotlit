// Markdown-edition stringify hook for `strong` and `emphasis` spans.
//
// fumadocs wraps every mdast-util-to-markdown handler and drops the handler's
// `peek`, so `containerPhrasing` dry-runs the attention handler and its
// flanking-encode flag leaks onto the preceding text: the serializer then
// writes the opening `*` as `&#x2A;` whenever the span sits next to
// punctuation, code, or a quote. Phrasing the span here, with the surrounding
// markers declared up front, bypasses that dry run.

import type { LLMsOptions } from "fumadocs-core/mdx-plugins";

type StringifyParams = Parameters<NonNullable<LLMsOptions["stringify"]>>;

/** @returns the serialized span, or `undefined` for any other node type. */
export function stringifyAttention(
  node: StringifyParams[0],
  state: StringifyParams[2],
  info: StringifyParams[3],
): string | undefined {
  if (node.type !== "strong" && node.type !== "emphasis") return undefined;
  const marker = node.type === "strong" ? "**" : "*";
  const content = state.containerPhrasing(node, {
    ...info,
    before: "*",
    after: "*",
  });
  return `${marker}${content}${marker}`;
}
