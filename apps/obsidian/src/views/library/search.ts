// The text in the Library View's search box, as the search reads it: the
// words go to the worker search, ranked as the quick switcher ranks, and
// each `tag:` token narrows to the Items with that tag.
//
// @see apps/obsidian/docs/adr/0072-search-enters-the-library-view-as-an-ordered-key-set.md
import { regex } from "arkregex";

/** A `tag:` token: a bare name, or a quoted one that may hold spaces. */
const TAG_TOKEN = regex(
  '(?:^|\\s)tag:(?:"(?<quoted>[^"]+)"|(?<bare>[^\\s"]+))',
  "gi",
);

export interface SearchTerms {
  /** The words the worker search ranks by; empty where the text holds only tags. */
  readonly words: string;
  /** The tags each Item must have, in the order the text names them. */
  readonly tags: readonly string[];
}

export function searchTerms(text: string): SearchTerms {
  const tags: string[] = [];
  TAG_TOKEN.lastIndex = 0;
  for (let match = TAG_TOKEN.exec(text); match; match = TAG_TOKEN.exec(text))
    tags.push((match.groups.quoted ?? match.groups.bare)!);
  const words = text.replace(TAG_TOKEN, " ").split(/\s+/).filter(Boolean);
  return { words: words.join(" "), tags };
}
