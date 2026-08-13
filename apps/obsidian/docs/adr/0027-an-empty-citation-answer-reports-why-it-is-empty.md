# An empty citation answer reports why it is empty

`zotlit:cited-by` and `zotlit:references` answer an empty list with
`omittedSyntaxes`, the excluded Citation Syntaxes that wrote Omitted Occurrences
in that answer's scope. An empty list there means the note cites nothing, or
that no note cites the item; a syntax it names means the citations are written
and uncounted. The field is present only on an empty answer, so a non-empty one
makes no claim about what it left out.

Every other field of both payloads is global index state: `database`,
`resolution`, and `syntaxes` read the same for every note, because `syntaxes`
echoes the Pandoc Citations and Wikilink Citations choices rather than any fact
about the queried document. The Wikilink Citations choice is off by default, so
in a stock vault a document whose citations are all Literature Note wikilinks
answers exactly as a document that cites nothing does. An agent that follows the
guide then states, correctly by the contract and falsely in fact, that the
document cites nothing. Only the index can tell the two apart, because it is the
index that drops an excluded syntax's occurrences before grouping them.

## Consequences

- The answer is computed where the question is asked: the excluded syntaxes are
  derived only when the list comes back empty, and each syntax stops at its
  first Omitted Occurrence. `zotlit:cited-by` therefore resolves wikilinks
  vault-wide only on an answer that has no groups, and its worst case stays the
  work it already does when the choice is on.
- A non-empty answer keeps reporting its completeness through `syntaxes` alone.
  In a stock vault, Literature Note links written for navigation resolve like
  cited ones, so a per-answer count on every reply would report a shortfall on
  ordinary notes and train an agent to ignore the field.
- An occurrence counts only where admitting its syntax would have changed this
  answer. `zotlit:references` counts a malformed Wikilink Citation, which would
  enter the answer as a `malformed` entry, and `zotlit:cited-by` does not, since
  only eligible occurrences reach a group.
- Masked text stays uncounted. A citation key inside code, math, frontmatter, or
  a `%%` comment is no Citation Occurrence, so a note holding only those cites
  nothing and the empty list says so truthfully.
- The Document Citation Set keeps its meaning — the occurrences a document
  contributes after the source choices apply — so `zotlit:references` takes the
  excluded syntaxes from a separate query rather than from the set the
  References Sidebar and the citation-text service share.
- `contractVersion` stays 1: the field arrived before contract version 1 had a
  published consumer, so no version of the wire format ever answered an empty
  list without it.
