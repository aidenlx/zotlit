import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const contentDirectory = resolve(import.meta.dirname, "../../content");
const catalogPath = resolve(
  import.meta.dirname,
  "../../../../messages/en.json",
);

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

function hasBareMessage(line: string): boolean {
  return line
    .split("{m.")
    .slice(0, -1)
    .some((before) => {
      const preceding = before.trimEnd().at(-1);
      return preceding !== "=" && preceding !== "$";
    });
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

  it("reaches Messages only through component props", () => {
    const bareMessages = getMdxFiles(contentDirectory).flatMap((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .flatMap((line, index) =>
          hasBareMessage(line)
            ? [`${relative(contentDirectory, path)}:${index + 1}`]
            : [],
        ),
    );

    expect(bareMessages).toEqual([]);
  });

  // A key renamed or removed in the catalog fails the docs build, which no
  // other check runs.
  it("names only Messages the catalog holds", () => {
    const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as Record<
      string,
      unknown
    >;
    const missing = getMdxFiles(contentDirectory).flatMap((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .flatMap((line, index) =>
          [...line.matchAll(/\bm\.(\w+)\(/g)]
            .filter(([, key]) => !Object.hasOwn(catalog, key!))
            .map(
              ([, key]) =>
                `${relative(contentDirectory, path)}:${index + 1} ${key}`,
            ),
        ),
    );

    expect(missing).toEqual([]);
  });
});
