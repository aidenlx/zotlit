# Annotation source handoff verification

Evidence for [issue #1160](https://github.com/aidenlx/zotlit/issues/1160),
recorded on 2026-09-19.

The repository publishes one complete Annotation collection per Attachment. It
keeps an owned published value while another source is checked. A rejected,
failed, or late candidate cannot replace that value through the query cache.

The Zotero Local API becomes an editing source only when the verified database
snapshot contains the same `localAPI.serverID`. A database without that setting
remains readable. A refresh reacquires the database after Zotero first creates
the setting. A different Server ID remains read-only and sends no write.

After an accepted API write, `Last-Modified-Version` records the local client
revision that a later database snapshot must cover. Database fallback keeps the
API result until the matching Library `clientVersion` reaches that floor. A
missing or invalid header supplies no revision evidence. Zotero 9 databases do
not contain client revision columns; they remain readable and cannot claim this
coverage.

API pagination uses the stable `dateAdded` order. It accepts the collection only
when page totals stay equal, keys do not overlap, and the final item count equals
the advertised total. These checks detect incomplete or shifted page walks.

The native API can expose cached mutable Reader fields before their client
revision changes. Equal headers or equal repeated payloads would not prove a
committed SQLite snapshot, so this implementation makes no such claim. A
successful native write response confirms that write. The verified database
client revision is the evidence used before fallback after that response.

Controlled tests verify complete publication, stale database retention after
color and deletion writes, later database coverage, missing revision headers,
uninitialized identity bootstrap, known identity mismatch, same-database
refresh during a write, changed-database late completion, and changing totals
during pagination.
