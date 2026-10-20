// Commits here carry no AI-agent attribution: no `Co-Authored-By` trailer for
// an agent, no session link, no agent as author or committer. The agent
// branch namespaces stay local. The commit-msg and pre-push hooks call this.
import { regex } from "arkregex";

// Patterns are lowercase; callers match against lowercased text.
const ATTRIBUTION_LINES = [
  regex("^\\s*co-authored-by:.*(claude|cursor|anthropic|copilot)"),
  regex("^\\s*claude-session:"),
  regex("generated with .*(claude|cursor)"),
  regex("^\\s*made with cursor"),
  regex("noreply@anthropic\\.com|cursoragent@cursor\\.com"),
];

const AGENT_IDENTITIES = [
  regex("noreply@anthropic\\.com|cursoragent@cursor\\.com"),
  regex("^(claude|cursor agent)( |$)"),
];

const AGENT_BRANCH = regex("^refs/heads/(claude|codex|cursor)/");

/** The lines of a commit message that credit an AI agent. */
export function attributionLines(message: string): string[] {
  return message
    .split("\n")
    .filter((line) =>
      ATTRIBUTION_LINES.some((re) => re.test(line.toLowerCase())),
    );
}

/** Whether an author or committer is an AI agent, by name or by email. */
export function isAgentIdentity(name: string, email: string): boolean {
  return AGENT_IDENTITIES.some(
    (re) => re.test(name.toLowerCase()) || re.test(email.toLowerCase()),
  );
}

/** Whether a pushed ref lives in an agent branch namespace. */
export function isAgentBranch(ref: string): boolean {
  return AGENT_BRANCH.test(ref);
}
