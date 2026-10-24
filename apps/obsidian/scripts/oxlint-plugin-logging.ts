// zotlit-logging: keeps Effect-native code on Effect's logging API
// (policies/logging.md). Rule tests: src/lint/logging.test.ts.
import { dirname, resolve, sep } from "node:path";

import type { AstNode, Rule } from "./oxlint-ast.ts";

const LOGTAPE_MODULE = "@logtape/logtape";
const OBSIDIAN_LOG_MODULE = "@/lib/log";
const LOG_MODULE_PATH = `${sep}src${sep}lib${sep}log`;
const LOG_FILE_SUFFIXES = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];

interface ModuleStatement extends AstNode {
  readonly source?: {
    readonly value?: unknown;
  };
}

interface ModuleProgram extends AstNode {
  readonly body?: readonly ModuleStatement[];
}

function isEffectModule(source: string): boolean {
  return (
    source === "effect" ||
    source.startsWith("effect/") ||
    source === "@/lib/effect" ||
    source.startsWith("@/lib/effect-")
  );
}

function isLogModule(source: string, filename: string): boolean {
  if (source === LOGTAPE_MODULE || source === OBSIDIAN_LOG_MODULE) return true;
  if (!source.startsWith(".")) return false;
  const target = resolve(dirname(filename), source);
  return (
    target.endsWith(LOG_MODULE_PATH) ||
    LOG_FILE_SUFFIXES.some((suffix) =>
      target.endsWith(`${LOG_MODULE_PATH}${suffix}`),
    )
  );
}

function hasSource(node: ModuleStatement): boolean {
  return (
    node.type === "ImportDeclaration" ||
    node.type === "ExportNamedDeclaration" ||
    node.type === "ExportAllDeclaration"
  );
}

/**
 * Rejects a LogTape logger import in a module that imports Effect, including
 * a type-only import or a re-export. Effect's logger carries the category,
 * annotations and spans through the host's configured sinks; a direct LogTape
 * import bypasses that contract (policies/logging.md).
 */
export const noLogTapeInEffectFile: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Log through Effect in a file that imports Effect.",
    },
    messages: {
      logtape:
        "log through Effect (`Effect.log*`, `withLogCategory`); a file that imports Effect imports no LogTape logger",
    },
    schema: [],
  },
  create(context) {
    return {
      Program(program) {
        const statements = (program as ModuleProgram).body ?? [];
        let effectNative = false;
        const logImports: ModuleStatement[] = [];
        for (const statement of statements) {
          if (!hasSource(statement)) continue;
          const source = statement.source?.value;
          if (typeof source !== "string") continue;
          if (isEffectModule(source)) effectNative = true;
          if (isLogModule(source, context.filename)) logImports.push(statement);
        }
        if (!effectNative) return;
        for (const node of logImports)
          context.report({ node: node as never, messageId: "logtape" });
      },
    };
  },
};

export default {
  meta: { name: "zotlit-logging" },
  rules: { "no-logtape-in-effect-file": noLogTapeInEffectFile },
};
