#!/usr/bin/env node

// Checked-in `obsidian-i18n` bin entry, so pnpm can link it at install time —
// before `dist/` exists. Delegates to the built CLI, which turbo builds via the
// `@zotlit/obsidian-i18n#build` dependency of every task that invokes the bin.

import "./dist/cli-main.mjs";
