import { posix } from "node:path";

/** Files that people and agents read and no build, test or check reads. */
const NAMES = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "CODING_STANDARDS.md",
  "CONTRIBUTING.md",
  "GLOSSARY.md",
  "README.md",
]);

/**
 * Whether `path` (relative to the repo root) is an agent doc: a steering or
 * policy file, an ADR, or a skill. Snapshots, fixture pages and the docs site
 * content are Markdown too, but code reads them, so they do not count.
 */
export function isAgentDoc(path: string): boolean {
  if (!path.endsWith(".md")) return false;
  if (NAMES.has(posix.basename(path))) return true;
  return (
    path.startsWith("policies/") ||
    path.includes("/policies/") ||
    path.startsWith("docs/") ||
    path.startsWith(".agents/") ||
    path.startsWith(".claude/")
  );
}

/** Whether a branch changes files and every one of them is an agent doc. */
export function isAgentDocsOnly(changed: readonly string[]): boolean {
  return changed.length > 0 && changed.every((path) => isAgentDoc(path));
}
