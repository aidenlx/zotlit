#!/usr/bin/env node
// Compiles the plugin's Language Packs outside a Vite build, for `mise run init`
// and the release workflow, under the same prefix rules the build applies.

import { compile } from "@zotlit/obsidian-i18n/compiler";

import {
  EXCLUDE_MESSAGE_PREFIXES,
  TARGET_LOCALE_MESSAGE_PREFIXES,
} from "#language-pack-options";

const result = await compile({
  root: import.meta.dirname,
  project: "../../../project.inlang",
  output: "../src/lib/i18n/generated",
  excludeMessagePrefixes: EXCLUDE_MESSAGE_PREFIXES,
  targetLocaleMessagePrefixes: TARGET_LOCALE_MESSAGE_PREFIXES,
});
process.stdout.write(`Generated ${result.messageCount} Message wrappers\n`);
if (result.warnings.length > 0) {
  process.stderr.write(`${result.warnings.join("\n")}\n`);
}
