# Native annotation concurrency boundary

Runtime evidence for issue #1165, recorded on 2026-09-19 against the disposable
Paired Run fixture.

## Versions and boundary

- Zotero: `10.0`, application build `20260817111755`, Gecko platform
  `140.14.0`.
- Zotero source revision inspected: `213b0d7d76bbda3881337b868c05dc114365d8c9`.
- ZotLit scenario base: `691c111d12b868e0a53f91fec26ee93851706d60`.
- Native endpoints: Zotero Local API on `127.0.0.1:63668`; actual initialized
  Zotero Reader callbacks over the scoped remote debugger on port `63687`.

The source exposes two concurrency boundaries. The single-object write handler
checks `clientVersion` at `server_localAPI.js:2161-2193`, mutates the shared
cached object, and later awaits `saveTx()` at `server_localAPI.js:2216-2228`.
The delete handler checks at `server_localAPI.js:2315-2333` and later awaits
`eraseTx()` at line 2335. A save awaits `_initSave` before its database
transaction (`dataObject.js:1033-1035` and `1079-1093`). The PATCH scenario
uses that completion boundary to hold a Reader save whose fields are already
present on the shared object; the DELETE scenario holds the erase after its
version check. Both gates are deterministic and use no timing sleep.

## Reproductions

### PATCH and Reader save

1. Create a disposable annotation at version 11.
2. Start a real Reader `_onSaveAnnotations` call with comment `Reader concurrent
   comment`. Pause its item after `_initSave`, before the database transaction.
3. PATCH the same annotation through the native Local API with expected version
   11 and comment `Local API concurrent comment`.
4. The PATCH returns 204. Release the Reader save; it also resolves normally.
5. Read the annotation independently through the Local API.

The final read returned version 13 and `Local API concurrent comment`. The
Reader value was absent. Both writers reported success, so this is a reproduced
silent lost update. A second run reproduced the result from initial version 20
to final version 22.

### DELETE and Reader save

1. Create a disposable annotation at version 14.
2. Start Local API DELETE with expected version 14. Pause `eraseTx` after the
   handler has accepted that precondition.
3. Save `Reader comment before paused delete` through the real Reader callback.
4. An independent Local API read returns the Reader value at version 15.
5. Release deletion. DELETE returns 204; an independent final read returns 404.

The stale delete removes the committed version 15 after it accepted version 14.
This reproduces the same non-atomic precondition boundary for deletion.
A second run accepted version 23, independently read the Reader value at
version 24, and then returned 204 and 404 in the same sequence.

## Repeat and restoration

With a prepared Paired Run, execute:

```sh
ZOTLIT_PAIRED_WORKSPACE_ROOT=/path/to/paired-run-worktree \
  pnpm --filter @zotlit/e2e exec vitest run \
  src/paired-run.e2e.ts -t 'Tier 4' --reporter=verbose
```

The run creates unique annotations, resets and later clears Local API
authorizations, restores all patched runtime methods, removes each disposable
annotation, and preserves a Reader tab that was already open. It hashes the
fixture PDF before and after the cases. The verified SHA-256 was
`95b6714aa1ce1e058475c9a807fa85e058bdaa5c3261e792dc5e8dfd9ae83ad6`.
Post-run inspection found no concurrency annotations, runtime hook, or retained
key list.

## Release implication and limits

Editing is unsafe at this native write boundary. The PATCH fix must detect or
preserve a Reader save that is already in flight on the same cached item. This
run does not establish that putting only the API version check and save in one
transaction is sufficient, because the Reader fields were pending before the
API request began. DELETE separately needs one atomic version-check-and-erase
boundary. A future fix must make these scenarios produce a visible conflict
response or another result that preserves the competing Reader value.

On 2026-09-20, the maintainer accepted both defects as known release risks in
[#1157](https://github.com/aidenlx/zotlit/issues/1157), superseding the earlier
release gate. The [PDF editing guide](../../apps/docs/content/docs/how-to/edit-pdf-annotations.mdx)
warns about comment loss and deletion of a recently updated Annotation. It
recommends editing in one application at a time and letting changes save before
switching. This reduces overlap without guaranteeing conflict protection.
The reproductions remain evidence of unresolved defects; upstream repair is
separate follow-up work. Other #1166 acceptance criteria still apply.

The test controls one in-process item instance and the actual Reader callback.
It proves these exact Zotero 10.0 interleavings. It does not measure the natural
race frequency, test another Zotero version, or validate an upstream fix. No
change was made to the separate Zotero checkout, and no client-side recovery or
required Companion endpoint was added.
