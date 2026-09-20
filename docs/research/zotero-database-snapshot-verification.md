# Zotero database snapshot verification

Runtime evidence for [issue #1159](https://github.com/aidenlx/zotlit/issues/1159), recorded on 2026-09-19.

## Verified acquisition behavior

Zotero 10 uses WAL mode and exclusive locking. ZotLit preserves its established
workaround: it clones the main database and WAL into a writable temporary
directory, then lets SQLite replay the clone. This makes the Companion's
checkpoint notification an optimization, not a requirement.

The acquisition reads full-content SHA-256 fingerprints from open source file
descriptors before and after the clone. It also fingerprints the acquired main
database and WAL. It accepts the clone only when the source bytes are stable
across the complete copy interval, the acquired bytes equal that stable source,
and no active rollback journal was observed. It then opens the clone through
SQLite and runs `integrity_check` as a structural check. SQLite's WAL commit
markers decide which frames are committed; `integrity_check` and file
fingerprints do not act as a committed-data oracle.

This boundary follows SQLite's warning that copying a live database without a
read lock can produce a corrupt backup: [How To Corrupt An SQLite Database
File](https://sqlite.org/howtocorrupt.html#_backup_or_restore_while_a_transaction_is_active).

Each source fingerprint checks the rollback journal before and after hashing
the main database and WAL. Main-file identity includes device, inode, size,
modification time, and change time across the full acquisition. Full-content
digests and acquired-copy equality remain the data checks; timestamps only add
evidence for an exact-byte ABA change.

SQLite can retain a rollback-journal file while a database stays in exclusive
locking mode. A commit invalidates that file by truncating it or clearing its
header. Acquisition therefore accepts a stable invalidated journal and rejects
a journal with SQLite's valid journal header. It brackets the header and file
metadata around each main-file fingerprint so a transaction transition makes
the attempt unstable. This follows SQLite's [rollback journal hotness
rules](https://www.sqlite.org/lockingv3.html#dealing_with_hot_journals).

Immutable fallback also uses an owned, verified snapshot. It first tries a
main-file reflink and uses a main-file copy when reflink is unavailable. Auto
and reflink modes instead use the verified main-plus-WAL copy after a reflink
capability failure, so standalone startup retains committed WAL rows. That
fallback reports `reflink-unsupported`. An explicitly configured immutable
read remains a verified main-only snapshot and reports `wal-not-replayed` when
that choice omits WAL-only commits.

Real SQLite tests establish these results:

- A clone exposes committed data from a non-empty WAL.
- A rollback journal prevents acquisition until the transaction rolls back;
  the accepted clone excludes the uncommitted value.
- An exclusive-lock database remains readable after commit when SQLite retains
  a non-empty journal with an invalidated header.
- Concurrent commits during main-file or WAL copy invalidate that attempt. A
  later accepted clone agrees with an independent SQL query.
- A committed write after rolled-back WAL tail reuse is detected when the WAL
  size and header are unchanged.
- Successful acquisition leaves the source main database and WAL bytes
  unchanged.

## Live Zotero 10 lock result

The Paired Run used Zotero 10.0 with the generated Fixture database at
`tmp/acceptance-fixture/zotero-data/zotero.sqlite`. Zotero kept a non-empty WAL
and held the database with its exclusive locking configuration.

A probe ran in installed Obsidian with Electron 43.7.1 and Node 24.21.0. A
direct read-only `node:sqlite` connection failed its first query after
approximately one second with SQLite code 5, `database is locked`. SQLite's
online backup API could not start. The attempt created no destination or
sidecar and did not change the source.

The replacement clone probe copied the locked Fixture main database and its
non-empty WAL. Full source hashes matched before and after the copy. SQLite
opened the clone, returned `ok` from `integrity_check`, read all 12 annotation
rows, and returned the user and group Library revisions. This verifies live
startup access at the database boundary while Zotero is open.

The main-plus-WAL clone remains necessary for this live-lock case. A failed
clone refresh keeps the previous working database client and reports the
refresh failure. The Zotero Local API can supply live annotation rows after the
repository knows the target identity.

Startup with Zotero already holding the exclusive lock has a separate bootstrap
limit. The Annotation View requires a ready database to resolve its target, and
the PDF path uses the database-backed Attachment Resolver. With no previous
database client, the current Local API path does not prove that it can bootstrap
those targets.

## Consumer evidence

With Zotero closed, a fresh plugin service session and no earlier API state in
that session read the Fixture through the database source. The Annotation View
showed all 8 cards, and each PDF showed all 13 marks. The repository reported a
read-only database source and Zotero unavailable.

An independent Zotero RDP query first returned item `PUPR5FG5` client revision
3 and Library 1 client revision 31, matching the cloned SQL values. After
Zotero reopened, saving that item's color as `#ff6666` returned item and Library
client revision 32. A new plugin service session read revision 32 from the
database; the Annotation View border was `rgb(255, 102, 102)` and the PDF mark
fill was `#ff6666`. Restoring `#2ea8e5` produced revision 33. An explicit shared
refresh then read item and Library revision 33 and updated both surfaces to the
restored blue.

This verifies standalone database startup in a fresh plugin service session
and one committed update through both consumers. It does not establish a full
Obsidian process cold start; issue #1166 owns that independent check.
