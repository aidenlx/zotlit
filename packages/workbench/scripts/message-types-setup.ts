// Vitest global setup: a direct `vitest run` skips turbo's generate:message-types,
// so a new worktree or a changed catalog would test against missing or stale
// message types. Regenerates them only when an input is newer than the output.
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(packageRoot, "../..");
const generator = join(packageRoot, "scripts/generate-message-types.ts");
const output = join(packageRoot, "src/ui/generated/messages.ts");

/** The same inputs turbo hashes for generate:message-types. */
function inputs(): string[] {
  const messages = join(workspaceRoot, "messages");
  return [
    generator,
    join(workspaceRoot, "project.inlang/settings.json"),
    ...readdirSync(messages).map((name) => join(messages, name)),
  ];
}

function modified(path: string): number {
  return statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? 0;
}

export default function setup() {
  const built = modified(output);
  if (inputs().every((input) => modified(input) <= built)) return;
  execFileSync(process.execPath, [generator], { stdio: "inherit" });
}
