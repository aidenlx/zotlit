// Generates the host message contract and the shared suite's English fixture.
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  emitObsidianArtifacts,
  loadMessageData,
} from "@zotlit/obsidian-i18n/compiler";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

const packageRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
const output = join(packageRoot, "src/ui/generated");
const data = await loadMessageData({
  project: join(workspaceRoot, "project.inlang"),
  includeMessagePrefixes: ["workbench_"],
});
const signatures = data.messages.map(({ id, inputs }) => {
  const parameter =
    inputs.length === 0
      ? ""
      : `inputs: { ${inputs.map(({ name, type }) => `${name}: ${type}`).join("; ")} }`;
  return `  readonly ${id}: (${parameter}) => string;`;
});
const dateType = data.messages.some(({ inputs }) =>
  inputs.some(({ type }) => type === "DatetimeInput"),
)
  ? 'import type { DatetimeInput } from "@zotlit/obsidian-i18n";\n\n'
  : "";
await mkdir(output, { recursive: true });
await writeFile(
  join(output, "messages.ts"),
  `// Generated from the root catalog. Hosts supply these functions.\n${dateType}export interface WorkbenchMessages {\n${signatures.join("\n")}\n}\n`,
);
const english = emitObsidianArtifacts(data).artifacts.find(
  ({ fileName }) => fileName === `${data.baseLocale}.json`,
)!;
await writeFile(join(output, "test-en.json"), english.contents);
