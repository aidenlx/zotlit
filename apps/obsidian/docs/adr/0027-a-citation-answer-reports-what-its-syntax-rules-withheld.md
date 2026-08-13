# A citation answer reports what its syntax rules withheld

Every successful answer of `zotlit:cited-by` and `zotlit:references` carries
`omittedSyntaxes`, the excluded Citation Syntaxes that wrote Omitted Occurrences
in that answer's scope. An empty list means the answer withheld nothing; a
syntax it names means the document or the item has citations the answer does not
report. The field is present whether or not the answer holds entries or groups,
so a short answer is visible as short.

Every other field of both payloads is global index state. `syntaxes` echoes the
Pandoc Citations and Wikilink Citations choices, which makes it the vault-wide
rule rather than a fact about the answer in hand. The Wikilink Citations choice
is off by default, so in a stock vault an answer that counts a document's
literal citations and silently drops its Literature Note wikilinks is shaped
exactly like a complete one. Dogfooding confirmed the shape is what misleads:
agents given only the citations skill were handed a `cited-by` answer listing
four citing notes while two more cited the work by wikilink, and `references`
answers that under-counted notes holding wikilink citations. None of them read
the standing `syntaxes` flag as a claim about the answer in front of them; each
resolved the doubt by searching the vault, which the skill forbids.

## Consequences

- An empty list is a completeness signal, so an agent can report an answer as
  whole without leaving the payload. The skill's reporting rule binds every
  answer rather than only a claim of absence.
- `zotlit:cited-by` resolves wikilinks vault-wide on every call while the choice
  is off. Each syntax stops at its first Omitted Occurrence, so the walk is
  short whenever something is withheld and runs in full on the clean answer. Its
  ceiling is the work the command already does when the choice is on.
- The field names syntaxes rather than counting occurrences. In a stock vault,
  Literature Note links written for navigation resolve like cited ones, so a
  count would report a shortfall on ordinary notes with a precision it does not
  have; an agent needs to know an answer is short, not by how much.
- An occurrence counts only where admitting its syntax would have changed this
  answer. `zotlit:references` counts a malformed Wikilink Citation, which would
  enter the answer as a `malformed` entry, and `zotlit:cited-by` does not, since
  only eligible occurrences reach a group.
- Masked text stays uncounted. A citation key inside code, math, frontmatter, or
  a `%%` comment is no Citation Occurrence, so an answer that omits it withheld
  nothing and reports an empty list truthfully.
- Both commands take the fact from a query of their own rather than from the
  data a view already follows. The Document Citation Set keeps its meaning — the
  occurrences a document contributes after the source choices apply — and the
  Cited By snapshot stays what the sidebar renders, so neither the References
  Sidebar, the citation-text service, nor the Cited By Sidebar pays for a fact
  only the CLI reports.
- `contractVersion` stays 1: the field arrived before contract version 1 had a
  published consumer, so no version of the wire format ever answered without it.
