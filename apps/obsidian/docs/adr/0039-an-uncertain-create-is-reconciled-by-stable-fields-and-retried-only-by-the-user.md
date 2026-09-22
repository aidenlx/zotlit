# An Uncertain Create is reconciled by stable fields and retried only by the user, on the same write token

Superseded by [ADR 0048](0048-annotation-drafts-and-pending-writes-stay-in-memory.md): pending writes stay in memory, and a failed or unconfirmed attempt prompts an ordinary refresh from Zotero. The original recovery workflow below is retained as history.

Protocol correction from the 2026-09-19 source review: Zotero holds write tokens in memory and can record a token when every item in the batch failed. A used-token response alone does not confirm creation, and token reuse alone does not guarantee a single creation.

A create through the Zotero Local API is a multi-object `POST` whose response carries the server-generated key; when that response is lost — a timeout, an abort, a closed reader — the Annotation may or may not exist in Zotero. ZotLit re-reads the Attachment's Annotations and matches the intended create on its stable fields: parent Attachment key, type, position rects rounded to three decimals, text, colour, and a `dateAdded` inside the window from request start to now. Exactly one match confirms the create; zero or several leave an Uncertain Create the user resolves with "Try again" or "Discard". "Try again" re-sends the original request with the original `Zotero-Write-Token`, which Zotero remembers for twelve hours and answers with a `412 Write token already used` when the first write landed, so the manual retry cannot create twice. Nothing retries on its own.

## Considered Options

- **Client-generated keys with `version: 0`, then read the key back** (rejected): the research doc's proposal. It makes reconciliation a single `GET`, but the charter locked server-generated keys, and Zotero's acceptance of every client key from its alphabet is an untested inference.
- **Write-token re-send as the only probe** (rejected): it is a write, not a read. Used first it would create the Annotation whenever the original never arrived, before the user has seen that the outcome was uncertain.
- **Automatic retry after a timeout** (rejected): the socket of an abandoned request stays live, so a late first write and an automatic second one race; the charter forbids it.
- **Stable-field match first, same-token manual retry second** (chosen).

## Consequences

- The repository keeps the write token and the request start instant for every create until the outcome is known.
- An Uncertain Create lives in memory only, as a badged card in the Annotation View under its Attachment; it is dropped on plugin reload, on a switch to the Zotero DB source, and on a Zotero Server ID change. After a reload the re-read shows the Annotation if it landed, so only the retry offer is lost.
- Any `412` is classified by body: a Server ID mismatch is a changed server, `Write token already used` confirms a landed create, and everything else is a Write Conflict.
