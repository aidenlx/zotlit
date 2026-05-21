import {
  Eta,
  EtaError,
  type EtaConfig,
  type Options,
  type TemplateFunction,
} from "eta/core";
import { dirname, isAbsolute, join, relative } from "node:path/posix";

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
  constructor(host: ObsidianEtaHost) {
    super({
      cache: true,
      autoEscape: false,
      autoFilter: true,
      filterFunction: filterUndefinedNull,
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
        `let include = (__eta_t, __eta_d) => this.render(__eta_t, __eta_d ?? ${varName}, options);`,
      )
      .replace(
        `let includeAsync = (__eta_t, __eta_d) => this.renderAsync(__eta_t, {...${varName}, ...(__eta_d ?? {})}, options);`,
        `let includeAsync = (__eta_t, __eta_d) => this.renderAsync(__eta_t, __eta_d ?? ${varName}, options);`,
      );
  },
};

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
