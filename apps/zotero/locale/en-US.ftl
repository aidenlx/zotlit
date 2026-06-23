# All message IDs must be prefixed `zotlit-`; the build fails otherwise.
# `src/types/fluent.d.ts` is regenerated from this file at build time.

zotlit-prefs-pane-label = ZotLit
zotlit-prefs-notify-section = Obsidian Notifications
zotlit-prefs-notify-enable =
    .label = Enable
zotlit-prefs-notify-url = Notify URL

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

zotlit-menu-item-open =
    .label = Open note in Obsidian
zotlit-menu-item-update =
    .label = { $count ->
        [one] Update note in Obsidian
       *[other] Update notes in Obsidian
    }
zotlit-menu-reader-annot-merge = Merge Annotations
zotlit-menu-reader-page-open = Open Note in Obsidian

zotlit-batch-update-server-needed-title = Can't update notes in Obsidian
zotlit-batch-update-server-needed-message = This selection is too large to send through a link. Enable the ZotLit server in Obsidian's settings, or select fewer items, and try again.
zotlit-batch-update-sending-title = Asking Obsidian to update notes…
zotlit-batch-update-failed-title = Couldn't reach Obsidian
zotlit-batch-update-failed-message = Make sure Obsidian is running with the ZotLit server enabled, then try again.
zotlit-batch-update-sent-title = Continue in Obsidian
zotlit-batch-update-sent-message = { $count ->
        [one] Asked Obsidian to update 1 note. Switch to Obsidian to continue.
       *[other] Asked Obsidian to update { $count } notes. Switch to Obsidian to continue.
    }
