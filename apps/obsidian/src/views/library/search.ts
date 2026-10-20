// The text in the Library View's search box, as the search reads it: the
// words go to the worker search, ranked as the quick switcher ranks, and
// each `tag:` token narrows to the Items with that tag. The Annotation
// Suggester reads its query in the same grammar, with `color:` and `paper:`
// beside `tag:`.
//
// @see apps/obsidian/docs/adr/0073-search-enters-the-library-view-as-an-ordered-key-set.md

export interface SearchTerms {
  /** The words the worker search ranks by; empty where the text holds only tags. */
  readonly words: string;
  /** The tags each Item must have, in the order the text names them. */
  readonly tags: readonly string[];
}

export interface SearchTokens<Name extends string> {
  /** The text outside the tokens, its words joined by one space. */
  readonly words: string;
  /** The values of each token name, in the order the text names them. */
  readonly tokens: { readonly [K in Name]: readonly string[] };
}

/**
 * Split `text` into words and `name:` tokens: a token is `name:` at the start
 * of the text or after whitespace, then a bare value or a quoted one that may
 * hold spaces. A name matches in any case. A name not in `names`, and a
 * `name:` with no value, stay among the words.
 *
 * @param names - lowercase token names, letters only.
 */
export function searchTokens<const Name extends string>(
  text: string,
  names: readonly Name[],
): SearchTokens<Name> {
  const tokens = Object.fromEntries(
    names.map((name) => [name, [] as string[]]),
  ) as Record<Name, string[]>;
  const token = new RegExp(
    `(?:^|\\s)(?<name>${names.join("|")}):(?:"(?<quoted>[^"]+)"|(?<bare>[^\\s"]+))`,
    "gi",
  );
  for (const match of text.matchAll(token)) {
    const { name, quoted, bare } = match.groups!;
    tokens[name!.toLowerCase() as Name].push((quoted ?? bare)!);
  }
  const words = text.replace(token, " ").split(/\s+/).filter(Boolean);
  return { words: words.join(" "), tokens };
}

export function searchTerms(text: string): SearchTerms {
  const { words, tokens } = searchTokens(text, ["tag"]);
  return { words, tags: tokens.tag };
}
