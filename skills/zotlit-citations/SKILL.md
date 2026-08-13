---
name: zotlit-citations
description: "Answer citation questions about an Obsidian vault through ZotLit: which notes cite a work, what a document cites, and why a citation is broken. Use whenever a user asks who cites something, what a note references, where a work is discussed, or why a citation does not resolve."
---

# ZotLit citations

## Start

Complete these steps in order before you answer a citation question.

1. `obsidian-cli help zotlit` — use only the commands and parameters it reports; commands reject what they do not declare.
2. `obsidian-cli zotlit:citations-guide` — the installed version's field semantics and workflow.
3. `obsidian-cli zotlit:template-status` — read `identity.source.id` from its answer, then pass `expect-source=<source-id>` on every later call.

Read the guide again after a ZotLit update.

## Target one vault and one Zotero library

Put `vault=<vault-name>` first when the working directory does not select the vault unambiguously:

```sh
obsidian-cli vault=MyVault zotlit:citations-guide
```

`obsidian-cli vault` shows the active vault, `obsidian-cli vaults` lists all known vaults. Confirm `identity.vault` once, then keep the same prefix.

Keep `expect-source=` on every call rather than trusting the library to stay connected. A user with more than one Zotero profile gets a wrong answer, not an error, when it is left off.

## Choose the selector

Ask the vault, never the filesystem: a text search over the vault misses the citation-key resolution, the user's citation-source choices, and the wikilink rules the index applies. Match the question to one selector:

- **A work the user names by its Zotero key** — query by key.
- **A work the user names by a citation key they saw in text**, such as `@doe2020` — query by citation key, with no lookup step first.
- **A work the user points at through a Literature Note** — take the Zotero key from that note, then query by key.
- **A work the user names only in prose** — ask which item they mean, or ask them to point at the note. Do not guess an item.
- **A document** — query its references by its vault path. Ask this of the user's own writing as readily as of a Literature Note.

## Read context from positions

The answers report where each citation is, not what surrounds it. When the user needs context:

1. Open the reported path.
2. Read the file at the reported position.
3. Widen to the sentence, paragraph, or section the question needs.

Quote the file you read, and name the note it came from. Never present text as something a command returned.

## Diagnose broken citations

Run the document's references, then group the entries by kind and turn each broken kind into the one correction its user can make — a citation key to fix in the note, or a work to add to Zotero.

Every such fix edits the user's writing or their Zotero library. Propose each change and wait for the user to accept it.

## Report what the answer is worth

An empty result is an answer: say that no note cites the work, rather than implying the query failed.

When the payload reports a degraded index state, give the answer and say plainly that it may be incomplete. When `syntaxes` reports a kind as `excluded`, say that too: citations written in that syntax are not counted. When a call fails, follow the recovery action in `diagnostic.hint` before you retry, and tell the user what you changed.

## Tone

Use plain language and name each step in everyday terms ("let me check which notes cite this paper"). Report notes by their path or title and works by their summary; add a Zotero key only when the user needs it for another command. Introduce a term such as citation key once, then use it freely.
