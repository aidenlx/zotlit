import "@codemirror/language";

/**
 * Obsidian runs its own fork of `@codemirror/language` (`lishid/cm-language`)
 * and the plugin builds every `@codemirror/*` package as external, so these two
 * fork-only exports resolve at runtime while the upstream types know nothing of
 * them.
 *
 * Obsidian's Markdown mode is a stream parser, so a syntax-tree node carries its
 * CSS-style token classes under these props instead of a Lezer node name:
 * `tokenClassNodeProp` on each token node, `lineClassNodeProp` on the one node
 * spanning a whole line.
 *
 * @see https://github.com/lishid/cm-language/blob/b817e72a9861b3f8a50a92a2ea53cbafc4f88eb3/src/stream-parser.ts#L454-L455
 */
declare module "@codemirror/language" {
  /** Space-separated token classes of a stream-parser token node. */
  export const tokenClassNodeProp: import("@lezer/common").NodeProp<string>;
  /** Space-separated line classes of the node spanning a whole line. */
  export const lineClassNodeProp: import("@lezer/common").NodeProp<string>;
}
