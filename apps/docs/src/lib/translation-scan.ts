// Compile-time author approval, read from actual native Fumadocs locale files.
// This module stays in Node; only its small manifest enters the app bundle.

import { regex } from "arkregex";
import { frontmatter } from "fumadocs-core/content/md/frontmatter";
import { getSlugs } from "fumadocs-core/source";
import type { Nodes } from "mdast";
import { existsSync, globSync, readFileSync } from "node:fs";
import {
  basename,
  dirname,
  extname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import remarkParse from "remark-parse";
import { unified } from "unified";

import type {
  TranslationManifest,
  TranslationStatus,
} from "./translation-state.js";

export interface TranslationFileState {
  /** Package-relative source path, useful in release-readiness diagnostics. */
  path: string;
  kind: "page" | "partial" | "meta" | "ui";
  status: TranslationStatus;
}

export interface TranslationReadiness {
  manifest: TranslationManifest;
  /** Includes partials and sidebar labels, which are never standalone pages. */
  files: TranslationFileState[];
  /** Expected Chinese counterparts that are absent, including the UI marker file. */
  missing: string[];
}

interface MarkdownFile {
  path: string;
  section: "docs" | "blog" | "changelog";
  relativePath: string;
  data: unknown;
  content: string;
  partial: boolean;
}

const sections = ["docs", "blog", "changelog"] as const;
const chineseSuffix = ".zh-CN";
const markdown = unified().use(remarkParse);
const includes = regex(
  "<include(?<attributes>\\s[^>]*)?>(?<specifier>[\\s\\S]*?)</include\\s*>",
  "g",
);

function slash(path: string): string {
  return path.split(sep).join("/");
}

function isChineseFile(path: string): boolean {
  return basename(path, extname(path)).endsWith(chineseSuffix);
}

function sourcePath(path: string): string {
  const extension = extname(path);
  return `${path.slice(0, -extension.length - chineseSuffix.length)}${extension}`;
}

function chinesePath(path: string): string {
  const extension = extname(path);
  return `${path.slice(0, -extension.length)}${chineseSuffix}${extension}`;
}

/** Any remaining marker is unapproved; deleting it is the author's approval. */
function hasMarker(data: unknown, key: string): boolean {
  return typeof data === "object" && data !== null && Object.hasOwn(data, key);
}

function status(ready: boolean): TranslationStatus {
  return ready ? "translated" : "placeholder";
}

/** Exclude examples and comments, which the MDX include transform never runs. */
function includeSource(content: string): string {
  const excluded: { start: number; end: number }[] = [];
  function visit(node: Nodes) {
    if (node.type === "code" || node.type === "inlineCode") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined)
        excluded.push({ start, end });
    } else if ("children" in node) {
      for (const child of node.children) visit(child);
    }
  }
  visit(markdown.parse(content));
  let source = content;
  for (const { start, end } of excluded.sort((a, b) => b.start - a.start)) {
    source = `${source.slice(0, start)}${source.slice(end)}`;
  }
  return source
    .replaceAll(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replaceAll(/<!--[\s\S]*?-->/g, "");
}

/** Local Markdown transclusions must point at the reviewed Chinese file itself. */
function dependencies(file: MarkdownFile, packageRoot: string): string[] {
  const source = includeSource(file.content);
  const paths: string[] = [];
  for (
    let match = includes.exec(source);
    match !== null;
    match = includes.exec(source)
  ) {
    const { attributes = "", specifier } = match.groups;
    const [path = ""] = specifier.trim().split("#");
    // Non-Markdown includes are code samples, which have no prose approval marker.
    if (!/\.mdx?$/.test(path) || /\blang\s*=/.test(attributes)) continue;
    const cwd = /\bcwd(?:\s|=|$)/.test(attributes)
      ? packageRoot
      : dirname(file.path);
    paths.push(resolve(cwd, path));
  }
  return paths;
}

/**
 * Scan both approval and release-readiness details. Files enter the page map
 * only when an actual Chinese page exists; loader fallback is never evidence
 * of a translation. Folder groups and native indexes use Fumadocs' own slugs.
 */
export function scanTranslationReadiness(
  packageRoot: string,
): TranslationReadiness {
  const files: TranslationFileState[] = [];
  const missing = new Set<string>();
  const content = new Map<string, MarkdownFile>();
  const pages: TranslationManifest["pages"] = {};

  for (const section of sections) {
    const cwd = resolve(packageRoot, "content", section);
    for (const path of globSync("**/*.{md,mdx,json}", { cwd }).sort()) {
      const absolutePath = join(cwd, path);
      const packagePath = slash(relative(packageRoot, absolutePath));
      if (extname(path) === ".json") {
        if (basename(path) === "meta.zh-CN.json") {
          files.push({
            path: packagePath,
            kind: "meta",
            status: status(
              !hasMarker(
                JSON.parse(readFileSync(absolutePath, "utf8")),
                "translationStatus",
              ),
            ),
          });
        } else if (
          basename(path) === "meta.json" &&
          !existsSync(chinesePath(absolutePath))
        ) {
          missing.add(slash(relative(packageRoot, chinesePath(absolutePath))));
        }
        continue;
      }
      if (section === "docs" && extname(path) !== ".mdx") continue;
      const parsed = frontmatter(readFileSync(absolutePath, "utf8"));
      content.set(absolutePath, {
        path: absolutePath,
        section,
        relativePath: slash(path),
        data: parsed.data,
        content: parsed.content,
        partial: basename(path).startsWith("_"),
      });
      if (!isChineseFile(path) && !existsSync(chinesePath(absolutePath))) {
        missing.add(slash(relative(packageRoot, chinesePath(absolutePath))));
      }
    }
  }

  const approved = new Map<string, boolean>();
  function isReady(path: string, visiting = new Set<string>()): boolean {
    const cached = approved.get(path);
    if (cached !== undefined) return cached;
    const file = content.get(path);
    if (!file || !isChineseFile(path) || visiting.has(path)) return false;
    const next = new Set(visiting).add(path);
    const ready =
      !hasMarker(file.data, "translationStatus") &&
      dependencies(file, packageRoot).every((dependency) =>
        isReady(dependency, next),
      );
    approved.set(path, ready);
    return ready;
  }

  for (const file of content.values()) {
    if (!isChineseFile(file.path)) continue;
    const fileStatus = status(isReady(file.path));
    files.push({
      path: slash(relative(packageRoot, file.path)),
      kind: file.partial ? "partial" : "page",
      status: fileStatus,
    });
    if (!file.partial) {
      const path = `/${[file.section, ...getSlugs(sourcePath(file.relativePath))].join("/")}`;
      if (Object.hasOwn(pages, path))
        throw new Error(`Duplicated Chinese page path: ${path}`);
      pages[path] = fileStatus;
    }
  }

  const uiPath = resolve(packageRoot, "i18n/zh-CN.json");
  const uiExists = existsSync(uiPath);
  const ui = status(
    uiExists && !hasMarker(JSON.parse(readFileSync(uiPath, "utf8")), "ui"),
  );
  if (uiExists) files.push({ path: "i18n/zh-CN.json", kind: "ui", status: ui });
  else missing.add("i18n/zh-CN.json");
  pages["/"] = ui;
  pages["/community"] = ui;
  pages["/workbench"] = ui;

  for (const section of ["blog", "changelog"] as const) {
    const sourcePages = [...content.values()].filter(
      (file) =>
        file.section === section && !file.partial && !isChineseFile(file.path),
    );
    pages[`/${section}`] = status(
      ui === "translated" &&
        sourcePages.every((file) => isReady(chinesePath(file.path))),
    );
  }

  return {
    manifest: { pages, ui },
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    missing: [...missing].sort(),
  };
}

/** The serializable subset Vite injects into server and browser builds. */
export function buildTranslationManifest(
  packageRoot: string,
): TranslationManifest {
  return scanTranslationReadiness(packageRoot).manifest;
}
