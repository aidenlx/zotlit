// The message-prefix rules that split the plugin's Language Pack from the copy
// the root inlang project holds for other hosts. Every caller that compiles the
// pack reads them from here, so one prefix is added in one place.

import { WORKBENCH_MESSAGE_PREFIX } from "@zotlit/config/paraglide";

/**
 * Prefixes other compiles own: `docs_` for the site, `workbench_` for the
 * Workbench UI's own Paraglide facade in `@zotlit/workbench/ui`. A Language
 * Pack is capped at 1000 messages, so copy that never reaches the plugin
 * stays out of the pack it would otherwise fill.
 */
export const EXCLUDE_MESSAGE_PREFIXES = [
  "docs_",
  WORKBENCH_MESSAGE_PREFIX,
  "zotero.",
] as const;

/** Companion labels quoted by the live-updates settings descriptions. */
export const INCLUDE_MESSAGES = [
  "zotero.prefs_notify_section",
  "zotero.prefs_notify_enable.label",
  "zotero.prefs_notify_url",
] as const;

/** Lifecycle copy has to be readable before its Language Pack exists. */
export const TARGET_LOCALE_MESSAGE_PREFIXES = [
  "notice_language_pack_",
  "settings_language_pack_",
] as const;
