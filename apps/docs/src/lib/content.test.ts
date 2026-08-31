import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const contentDirectory = resolve(import.meta.dirname, "../../content");

function getMdxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return getMdxFiles(path);
    return entry.isFile() && entry.name.endsWith(".mdx") ? [path] : [];
  });
}

function isLinkedHeading(line: string): boolean {
  const content = line.trimStart();
  const markerEnd = content.indexOf(" ");
  if (markerEnd < 1 || markerEnd > 6) return false;
  if (content.slice(0, markerEnd) !== "#".repeat(markerEnd)) return false;

  const labelStart = content.indexOf("[", markerEnd + 1);
  return labelStart >= 0 && content.indexOf("](", labelStart + 1) > labelStart;
}

describe("MDX content", () => {
  it("keeps links outside headings", () => {
    const linkedHeadings = getMdxFiles(contentDirectory).flatMap((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .flatMap((line, index) =>
          isLinkedHeading(line)
            ? [`${relative(contentDirectory, path)}:${index + 1}`]
            : [],
        ),
    );

    expect(linkedHeadings).toEqual([]);
  });
});
