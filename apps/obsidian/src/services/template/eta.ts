import {
  Eta,
  EtaError,
  type EtaConfig,
  type Options,
  type TemplateFunction,
} from "eta/core";
import { dirname, isAbsolute, join, relative } from "node:path/posix";

import { MARKER_END, MARKER_START } from "@/lib/constants";
import { type AutoTrim } from "@/services/settings/schema";

import { toFilename } from "./defaults";
import { normalizeVaultPath } from "./path";

export interface ObsidianEtaHost {
  getAutoTrim(): [AutoTrim, AutoTrim];
  getTemplateFolder(): string;
  prepareTemplate(path: string): void;
  readTemplateContent(path: string): string;
}

export class ObsidianEta extends Eta {
  /**
   * Wraps a captured block in a blockquote. Referenced from `functionHeader`
   * as `this.bqHelper`; must stay public so generated template code can reach
   * it.
   */
  readonly bqHelper = formatBlockquote;
  readonly managedRegion = formatManagedRegion;

  constructor(host: ObsidianEtaHost) {
    super({
      cache: true,
      varName: "zt",
      autoEscape: false,
      autoFilter: true,
      filterFunction: filterUndefinedNull,
      // `bq(() => { ... })` blockquotes a captured block. Opened in an evaluate
      // tag (not `<%~ %>`): autoFilter wraps raw interpolations in a call whose
      // closing paren collides with the callback's `{`.
      functionHeader: "const bq = (fn) => output(this.bqHelper(capture(fn)));",
      plugins: [directIncludeDataPlugin],
    });

    Object.defineProperties(this.config, {
      autoTrim: {
        configurable: true,
        get: () => host.getAutoTrim(),
      },
      views: {
        configurable: true,
        get: () => host.getTemplateFolder(),
      },
    } satisfies PropertyDescriptorMap &
      Record<keyof Pick<EtaConfig, "autoTrim" | "views">, PropertyDescriptor>);

    this.resolvePath = resolveTemplatePath;
    this.readFile = (_path) => host.readTemplateContent(_path);

    const renderBase = this.render;
    this.render = ((template, data, meta) => {
      if (typeof template === "string" && !template.startsWith("@")) {
        host.prepareTemplate(resolveTemplatePath.call(this, template, meta));
      }
      return renderBase.call(this, template, data, meta);
    }) as typeof this.render;
  }
}

const directIncludeDataPlugin: EtaConfig["plugins"][number] = {
  processFnString(fnString, config) {
    const varName = config?.varName ?? "it";
    // v1 templates pass arrays to include(); Eta 4's default helper spreads
    // include data into the parent object, which turns arrays into objects.
    return fnString
      .replace(
        `let include = (__eta_t, __eta_d) => this.render(__eta_t, {...${varName}, ...(__eta_d ?? {})}, options);`,
        `let include = (__eta_t, __eta_d) => { const __eta_r = this.render(__eta_t, __eta_d ?? ${varName}, options); return __eta_t === "content" ? this.managedRegion(__eta_r) : __eta_r; };`,
      )
      .replace(
        `let includeAsync = (__eta_t, __eta_d) => this.renderAsync(__eta_t, {...${varName}, ...(__eta_d ?? {})}, options);`,
        `let includeAsync = async (__eta_t, __eta_d) => { const __eta_r = await this.renderAsync(__eta_t, __eta_d ?? ${varName}, options); return __eta_t === "content" ? this.managedRegion(__eta_r) : __eta_r; };`,
      );
  },
};

/**
 * Prefix every line of a block with `"> "` so multi-line content stays inside
 * an Obsidian blockquote/callout. Blank lines become a bare `">"`; consecutive
 * blanks collapse to one. Surrounding whitespace is trimmed so the leading and
 * trailing newlines `capture()` inherits from template layout don't leak in.
 */
export function formatBlockquote(content: string): string {
  const lines = content
    .trim()
    .split("\n")
    .map((line) => (line.trim() === "" ? ">" : `> ${line}`));
  return lines
    .filter((line, i) => !(line === ">" && lines[i - 1] === ">"))
    .join("\n");
}

export function formatManagedRegion(content: string): string {
  return `${MARKER_START}\n${content.trim()}\n${MARKER_END}`;
}

function filterUndefinedNull(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return value as string;
}

function completeTemplatePath(templatePath: string): string {
  if (templatePath === "") throw new EtaError("Template name is empty");

  const canonicalFilename = toFilename(templatePath);
  if (canonicalFilename) return canonicalFilename;
  if (templatePath.endsWith(".eta.md")) return templatePath;
  if (templatePath.endsWith(".eta")) return `${templatePath}.md`;
  return `${templatePath}.eta.md`;
}

export function resolveTemplatePath(
  this: Eta,
  templatePath: string,
  options?: Partial<Options>,
): string {
  const views = this.config.views;
  if (views === undefined) {
    throw new EtaError("Views directory is not defined");
  }

  const normalizedViews = normalizeVaultPath(views);
  const baseFilePath = options?.filepath;
  const cacheIndex = JSON.stringify({
    filename: baseFilePath,
    path: templatePath,
    views: normalizedViews,
  });

  const completedPath = completeTemplatePath(templatePath).replaceAll(
    "\\",
    "/",
  );
  let resolvedFilePath: string;

  if (baseFilePath) {
    if (this.config.cacheFilepaths && this.filepathCache[cacheIndex]) {
      return this.filepathCache[cacheIndex]!;
    }
    resolvedFilePath = isAbsolute(completedPath)
      ? join(normalizedViews, normalizeVaultPath(completedPath))
      : join(dirname(normalizeVaultPath(baseFilePath)), completedPath);
  } else {
    resolvedFilePath = join(normalizedViews, completedPath);
  }

  resolvedFilePath = normalizeVaultPath(resolvedFilePath);
  if (!dirContainsPath(normalizedViews, resolvedFilePath)) {
    throw new EtaError(
      `Template '${completedPath}' is not in the views directory`,
    );
  }

  if (baseFilePath && this.config.cacheFilepaths) {
    this.filepathCache[cacheIndex] = resolvedFilePath;
  }
  return resolvedFilePath;
}

function dirContainsPath(parent: string, path: string): boolean {
  const relativePath = relative(parent, path);
  return (
    relativePath !== "" &&
    !relativePath.startsWith("..") &&
    !isAbsolute(relativePath)
  );
}

export type { TemplateFunction };
