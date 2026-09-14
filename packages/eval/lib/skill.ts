// Reads a skill's identity from its SKILL.md frontmatter.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface SkillMd {
  /** The `name:` frontmatter value. */
  name: string;
  /** The `description:` frontmatter value, with any YAML block scalar folded to one line. */
  description: string;
  /** The whole file, frontmatter included. */
  content: string;
}

const BLOCK_SCALAR_INDICATORS = new Set([">", "|", ">-", "|-"]);

function unquote(value: string): string {
  return value.replaceAll(/^['"]|['"]$/g, "");
}

/**
 * Parse the frontmatter block of a SKILL.md file.
 *
 * A block scalar description (`>` / `|` and their chomping variants) folds its
 * indented continuation lines into one space-separated string.
 */
export function parseSkillMd(content: string): Omit<SkillMd, "content"> {
  const lines = content.split("\n");

  if (lines[0]?.trim() !== "---") {
    throw new Error("SKILL.md is missing its frontmatter opening ---");
  }

  const endIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  if (endIndex === -1) {
    throw new Error("SKILL.md is missing its frontmatter closing ---");
  }

  const frontmatter = lines.slice(1, endIndex);
  let name = "";
  let description = "";

  for (let i = 0; i < frontmatter.length; i++) {
    const line = frontmatter[i]!;
    if (line.startsWith("name:")) {
      name = unquote(line.slice("name:".length).trim());
      continue;
    }
    if (!line.startsWith("description:")) continue;

    const value = line.slice("description:".length).trim();
    if (!BLOCK_SCALAR_INDICATORS.has(value)) {
      description = unquote(value);
      continue;
    }

    const continuation: string[] = [];
    while (/^[ \t]/.test(frontmatter[i + 1] ?? "")) {
      continuation.push(frontmatter[++i]!.trim());
    }
    description = continuation.join(" ");
  }

  return { name, description };
}

/** Read and parse `<skillPath>/SKILL.md`. */
export async function readSkillMd(skillPath: string): Promise<SkillMd> {
  const content = await readFile(join(skillPath, "SKILL.md"), "utf8");
  return { ...parseSkillMd(content), content };
}
