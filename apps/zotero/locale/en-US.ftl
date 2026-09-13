# All message IDs must be prefixed `zotlit-`; the build fails otherwise.
# `src/types/fluent.d.ts` is regenerated from this file at build time.

zotlit-prefs-pane-label = ZotLit
zotlit-prefs-notify-section = Obsidian Notifications
zotlit-prefs-notify-enable =
    .label = Enable
zotlit-prefs-notify-description = Notifies ZotLit in Obsidian as you read and annotate, and when the database file has new changes.
zotlit-prefs-notify-url = Notify URL

zotlit-prefs-database-section = Database
zotlit-prefs-wal-checkpoint =
    .label = Keep the database file up to date for Obsidian
zotlit-prefs-wal-checkpoint-description = Writes recent changes from the write-ahead log to the main database file so ZotLit reads current data.

zotlit-prefs-logging-section = Logging
zotlit-prefs-logging-level = Console log level
zotlit-prefs-log-level-trace =
    .label = Trace
zotlit-prefs-log-level-debug =
    .label = Debug
zotlit-prefs-log-level-info =
    .label = Info
zotlit-prefs-log-level-warning =
    .label = Warning
zotlit-prefs-log-level-error =
    .label = Error
zotlit-prefs-log-level-fatal =
    .label = Fatal

# Menu labels use Title Case, matching Zotero's own menus. Entries inside the
# ZotLit submenu omit "in Obsidian" — the submenu already scopes them; entries
# appended flat to Zotero's menus keep it.
zotlit-menu-item-open =
    .label = Open Literature Note in Obsidian
zotlit-menu-submenu =
    .label = ZotLit
zotlit-menu-item-update =
    .label = { $count ->
        [one] Create or Update Literature Note
       *[other] Create or Update Literature Notes
    }
zotlit-menu-item-update-metadata =
    .label = Update Literature Note Metadata
zotlit-menu-item-import-child-notes =
    .label = Import Child Notes
zotlit-menu-item-import-notes =
    .label = { $count ->
        [one] Import Selected Note
       *[other] Import Selected Notes
    }
zotlit-menu-item-explore =
    .label = Explore Template Data
zotlit-menu-collection-update-all =
    .label = Create or Update Literature Notes
zotlit-menu-collection-import-all-notes =
    .label = Import Child and Standalone Notes
zotlit-menu-item-copy-key =
    .label = { $count ->
        [one] { $kind ->
            [attachment] Copy Attachment Key
            [childNote] Copy Child Note Key
            [note] Copy Note Key
           *[item] Copy Item Key
        }
       *[other] { $kind ->
            [attachment] Copy Attachment Keys
            [childNote] Copy Child Note Keys
            [note] Copy Note Keys
            [item] Copy Item Keys
           *[mixed] Copy Selected Keys
        }
    }
zotlit-menu-reader-annot-explore = Explore Annotation in Obsidian
zotlit-menu-reader-annot-copy-key = Copy Annotation Key
zotlit-menu-reader-page-open = Open Literature Note in Obsidian

zotlit-batch-update-server-needed-title = Can't update literature notes in Obsidian
zotlit-batch-update-server-needed-message = This selection is too large to send through a link. Enable the ZotLit server in Obsidian's settings, or select fewer items, and try again.
zotlit-batch-update-sending-title = Asking Obsidian to update literature notes…
zotlit-batch-update-failed-title = Couldn't reach Obsidian
zotlit-batch-update-failed-message = Make sure Obsidian is running with the ZotLit server enabled, then try again.
zotlit-batch-update-sent-title = Continue in Obsidian
zotlit-batch-update-sent-message = { $count ->
        [one] Asked Obsidian to update 1 literature note. Switch to Obsidian to continue.
       *[other] Asked Obsidian to update { $count } literature notes. Switch to Obsidian to continue.
    }

zotlit-protocol-incompatible-title = Update required
zotlit-protocol-incompatible-message = The ZotLit Obsidian plugin is on an incompatible version. Update both the Zotero and Obsidian plugins to matching versions and try again.

zotlit-batch-import-sending-title = Asking Obsidian to import notes…
zotlit-batch-import-failed-title = Couldn't reach Obsidian
zotlit-batch-import-failed-message = Make sure Obsidian is running with the ZotLit server enabled, then try again.
zotlit-batch-import-sent-title = Continue in Obsidian
zotlit-batch-import-sent-message = { $count ->
        [one] Asked Obsidian to import 1 note. Switch to Obsidian to continue.
       *[other] Asked Obsidian to import { $count } notes. Switch to Obsidian to continue.
    }

zotlit-column-obsidian-note = Literature Note
zotlit-menu-tools-refresh-note-status =
    .label = ZotLit: Refresh Literature Note Status
zotlit-note-status-refreshing-title = Refreshing literature note status…
zotlit-note-status-refreshed-title = Literature note status refreshed
zotlit-note-status-refreshed-message = { $count ->
        [one] 1 item has a literature note in Obsidian.
       *[other] { $count } items have literature notes in Obsidian.
    }
zotlit-note-status-refresh-failed-title = Couldn't refresh literature note status
zotlit-note-status-refresh-failed-message = Make sure Obsidian is running with the ZotLit server enabled, then try again.

zotlit-database-status =
    .tooltiptext = Database Status
zotlit-database-status-icon-off =
    .tooltiptext = Database Status — automatic writes off
zotlit-database-status-icon-failed =
    .tooltiptext = Database Status — last write failed
zotlit-database-status-working = Changes are being written to the database file for Obsidian.
zotlit-database-status-automatic-off = Automatic writes to the database file are off. You can still write changes manually.
zotlit-database-status-no-wal = This database does not use a write-ahead log. Changes are already in the database file.
zotlit-database-status-failed = The last attempt to write changes to the database file failed.
zotlit-database-status-never-written = Nothing has been written yet.
zotlit-database-status-last-written = Last wrote changes { $time }.
zotlit-database-status-last-attempt = Last attempt was { $time }.
zotlit-database-status-write-now = Write Changes to Database File Now
zotlit-database-status-guide = Fix Stale Data…
zotlit-database-write-running-title = Writing changes to the database file…
zotlit-database-write-done-title = Database file updated
zotlit-database-write-done-message = Recent changes are now available to Obsidian.
zotlit-database-write-in-use-title = Database file is in use
zotlit-database-write-in-use-message = Wait a moment, then try again.
zotlit-database-write-failed-title = Couldn't write changes to the database file
zotlit-database-write-failed-message = Collect <a href="{ $debugLogsUrl }" tooltiptext="{ $debugLogsUrl }">Zotero debug logs</a>, then report the problem.
