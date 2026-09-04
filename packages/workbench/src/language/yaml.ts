// YAML editor language, for the JSON-e rules a Managed Frontmatter entry writes.

import { yaml as yamlSupport } from "@codemirror/lang-yaml";

/**
 * A rule is YAML — JSON is the flow form of it — so a pane over one rule reads
 * it as YAML rather than as the Liquid-in-Markdown the note body is written in.
 */
export const yamlRule = yamlSupport();
