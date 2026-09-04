// The message-prefix rules that split the plugin's Language Pack from the copy
// the root inlang project holds for other hosts. Every caller that compiles the
// pack reads them from here, so one prefix is added in one place.

/**
 * Prefixes `apps/docs` owns: `docs_` for the site, `workbench_` for the web
 * Template Workbench. A Language Pack is capped at 1000 messages, so copy that
 * never reaches the plugin stays out of the pack it would otherwise fill.
 */
export const EXCLUDE_MESSAGE_PREFIXES = ["docs_", "workbench_"] as const;

/** Lifecycle copy has to be readable before its Language Pack exists. */
export const TARGET_LOCALE_MESSAGE_PREFIXES = [
  "notice_language_pack_",
  "settings_language_pack_",
] as const;
