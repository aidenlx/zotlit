# Local storage

Per-vault UI state goes through `app.loadLocalStorage(key)` / `app.saveLocalStorage(key, value)` — Obsidian namespaces these per vault. Never touch `window.localStorage` directly. Pass `null` as the value to delete a key.
