// The text in the Library View's search box, as the search reads it: the
// words go to the worker search, ranked as the quick switcher ranks, and
// each `tag:` token narrows to the Items with that tag. The Annotation
// Suggester reads its query in the same grammar, with `color:` and `paper:`
// beside `tag:`.
//
// @see apps/obsidian/docs/adr/0073-search-enters-the-library-view-as-an-ordered-key-set.md
import { regex } from "arkregex";

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
  const isName = (name: string): name is Name =>
    (names as readonly string[]).includes(name);
  let rest = "";
  let from = 0;
  TOKEN.lastIndex = 0;
  for (let match = TOKEN.exec(text); match; match = TOKEN.exec(text)) {
    const name = match.groups.name.toLowerCase();
    if (!isName(name)) continue;
    tokens[name].push((match.groups.quoted ?? match.groups.bare)!);
    rest += `${text.slice(from, match.index)} `;
    from = match.index + match[0].length;
  }
  rest += text.slice(from);
  const words = rest.split(/\s+/).filter(Boolean);
  return { words: words.join(" "), tokens };
}

/**
 * A `name:` token: a bare value, or a quoted one that may hold spaces. Every
 * name matches here; {@link searchTokens} keeps the ones it was given.
 */
const TOKEN = regex(
  '(?:^|\\s)(?<name>[a-z]+):(?:"(?<quoted>[^"]+)"|(?<bare>[^\\s"]+))',
  "gi",
);

export function searchTerms(text: string): SearchTerms {
  const { words, tokens } = searchTokens(text, ["tag"]);
  return { words, tags: tokens.tag };
}
