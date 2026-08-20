# The freshness push is a payload-free signal sent after the checkpoint

The Obsidian plugin needs to know when the Zotero database changed. The companion used to push a semantic `item/update` event at write time, carrying per-item add/modify/trash ids. The receiver discarded the payload entirely (every refresh swaps in a whole new snapshot client, so invalidation is always total), the event's trigger set (`item` only) was narrower than the checkpoint's write-trigger list, and its pre-checkpoint timing forced a numeric contract across two apps: Obsidian's immutable-watch debounce had to outlast the companion's checkpoint delay so a refresh would not read the stale main file.

We replaced it with the **Freshness Signal**: one payload-free `db/updated` event (protocol version 6) that the companion's freshness pipeline sends *after* its debounced run settles — checkpoint first where the database uses a WAL, then the signal. Receiving the signal therefore implies the main database file is already as current as the companion can make it: the ordering is causal, not temporal, and the cross-app debounce contract is gone.

## Consequences

- The signal fails open: it follows write activity even when the checkpoint preference is off, the checkpoint failed, or the database uses a rollback journal (where commits land in the main file directly). A clone-mode reader still benefits in every one of those cases.
- The `notify` preference gates the signal; the `wal-checkpoint` preference gates only the checkpoint step. The two stay independent, and the Database Status control follows the checkpoint alone.
- A manual **Write Changes to Database File Now** also signals on `done` and `in-use` (a partial truncation may have moved frames), and stays silent on `failed` (nothing moved, a refresh would find nothing new).
