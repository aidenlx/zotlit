# @zotlit/zotero

## Dev workflow

- `pnpm serve` runs Vite in watch mode, launches Zotero 9, installs `dist-dev/addon/` over RDP, and reloads the add-on after successful rebuilds.
- Configure `apps/zotero/.env` from `apps/zotero/.env.example`; `ZOTERO_PLUGIN_ZOTERO_BIN_PATH` is required.
- `ZOTERO_PLUGIN_PROFILE_PATH` is optional. When unset, the runner uses `apps/zotero/.zotero-dev/profile`.
- `ZOTERO_PLUGIN_DATA_DIR` is optional. When both profile and data dir are unset, the runner uses `apps/zotero/.zotero-dev/data`.
- The runner writes the narrow remote-debugging prefs from `RDP_LAUNCH.md` into the selected dev profile's `user.js`.
