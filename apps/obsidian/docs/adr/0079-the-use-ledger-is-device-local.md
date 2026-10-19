# The Use Ledger is device-local

The Use Ledger, which records the last Use of each Item for Last Activity, lives in the vault's local storage on each device, beside the Device Overrides, and never syncs. A Use happens often, at every note open and tab return. In plugin data, each one would rewrite the settings file, and two devices that sync the vault would race on that whole file, so a ledger write on one device could undo a setting changed on the other. What matters most across devices is reading, and it already crosses devices through Zotero: `lastRead` syncs with the Zotero library, and a read in Obsidian's PDF view reaches it through write-back when the researcher has granted Write Authorization (#1533).

Proposed on 2026-10-19 with [#1532](https://github.com/aidenlx/zotlit/issues/1532).

## Considered Options

- **Plugin data (`data.json`), synced with the vault** (rejected): what #1532 and #1533 first assumed. Every Use would rewrite the settings file and race with settings changes on other devices.
- **A file of its own in the plugin folder** (rejected): it avoids the settings race, but two devices still overwrite each other's whole ledger, and whether vault sync carries the file depends on the sync service.
- **Vault-scoped local storage, per device** (chosen): no sync race and no settings migration, and the same storage the Device Overrides use.

## Consequences

- A Literature Note opened or a citation inserted on one device does not move the Item in Recent on another; reading in Zotero, or in Obsidian with write-back, does.
- A new device starts with an empty Use Ledger; Zotero activity orders its list until Uses accrue.
- The ledger has no settings schema entry, version or migration.
