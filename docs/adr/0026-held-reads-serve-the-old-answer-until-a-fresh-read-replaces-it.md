# Held Reads serve the old answer until a fresh read replaces it

Citation surfaces depend on asynchronous derived values: Document Citation Text, bibliography renders, and the Citekey Resolution Snapshot. Each owner previously represented the same questions in a different way: whether an answer exists, whether it is fresh, and whether a replacement read is running. Those local state machines caused surfaces to replace useful answers with pending or failure states during revalidation.

These values now use **Held Reads**. A Held Read keeps the last successful value available while a fresh read replaces it. Pending is the absence of a Held Read. Invalidation marks a settled value stale and keeps it available; the next read starts one replacement and all concurrent readers join it. A failed replacement keeps the value with a failed status until another invalidation re-arms it. A commit applies only to the record that started it, so a superseded read cannot publish.

## Consequences

- Citation surfaces keep their old answer during revalidation and failure. They show pending only before the first successful answer.
- All held values use the same changed, settled, and invalidated event contract. A changed event means the value differs; a settled event also reports equal and failed reads.
- The store is a bounded least-recently-used collection. Every peek refreshes recency because a peek is an ask.
- A value owner can define semantic equality. An equal fresh value keeps the old identity while settlement still wakes state-only consumers.
