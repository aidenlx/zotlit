// The websites a Local Bridge answers, fixed in code. No setting edits this
// list: a Workbench Connection reaches the vault, so the set of pages allowed
// to hold one is a property of the build, not of a preference.

import { DOCS_DEV_SERVER_ORIGIN } from "@zotlit/workbench/bridge";

/** Stable Docs — the website a stable plugin build opens. */
export const STABLE_DOCS_ORIGIN = "https://zotlit.aidenlx.site";

/** Pre-release Docs — the website a pre-release plugin build opens. */
export const PRERELEASE_DOCS_ORIGIN = "https://zotlit-beta.aidenlx.site";

/**
 * Both release lines are allowed on every build: which one the plugin *opens*
 * is baked per line (`DOCS_SITE_URL`), while a page kept open across a channel
 * switch still has to be able to resume. The docs dev server joins them in a
 * development build only.
 */
export const ALLOWED_DOCS_ORIGINS: readonly string[] = __DEV__
  ? [STABLE_DOCS_ORIGIN, PRERELEASE_DOCS_ORIGIN, DOCS_DEV_SERVER_ORIGIN]
  : [STABLE_DOCS_ORIGIN, PRERELEASE_DOCS_ORIGIN];
