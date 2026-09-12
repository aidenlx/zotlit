// The message-prefix rules that split the plugin's Language Pack from the copy
// the root inlang project holds for other hosts. Every caller that compiles the
// pack reads them from here, so one prefix is added in one place.

/** The site and Companion own these namespaces; the plugin also renders Workbench copy. */
export const EXCLUDE_MESSAGE_PREFIXES = ["docs_", "zotero."] as const;

/** Companion labels quoted by the live-updates settings descriptions. */
export const INCLUDE_MESSAGES = [
  "zotero.prefs_notify_section",
  "zotero.prefs_notify_enable.label",
  "zotero.prefs_notify_url",
] as const;

/** Scoped facade used where the Workbench passes its Messages as an object. */
export const SCOPED_MESSAGE_MODULES = {
  "workbench-messages.ts": ["workbench_"],
} as const;

/** Lifecycle copy has to be readable before its Language Pack exists. */
export const TARGET_LOCALE_MESSAGE_PREFIXES = [
  "notice_language_pack_",
  "settings_language_pack_",
] as const;
