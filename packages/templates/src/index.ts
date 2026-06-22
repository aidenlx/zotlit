import {
  Eta,
  EtaError,
  EtaParseError,
  type EtaConfig,
  type TemplateFunction,
} from "eta/core";

import { Temporal } from "@zotlit/shared/temporal";

import { basename } from "./basename";
import { type AutoTrim } from "./constants";
import { replaceHelper } from "./replace-helper";

export interface TemplateEngineOptions {
  /** @default [false, false] */
  autoTrim?: readonly [AutoTrim, AutoTrim];
  /**
   * Post-process a named render's output, keyed by the template name passed to
   * `render()`/`include()`. Runs for both direct `render()` and includes (which
   * eta compiles to `this.render`), so a given name renders identically by
   * either path.
   *
   * @default identity — when omitted, output passes through unchanged
   * @see `managedRegionTransform` in `@zotlit/templates/obsidian`, which the
   *   Obsidian host injects to wrap its content template in managed-region markers
   */
  transformRender?: (name: string, output: string) => string;
}

export class TemplateEngine extends Eta {
  readonly #sources = new Map<string, string>();

  readonly bqHelper = formatBlockquote;
  readonly basenameHelper = basename;

  constructor({
    autoTrim = [false, false],
    transformRender,
  }: TemplateEngineOptions = {}) {
    super({
      cache: true,
      varName: "zt",
      autoTrim: [...autoTrim],
      autoEscape: false,
      autoFilter: true,
      filterFunction: filterUndefinedNull,
      functionHeader:
        "const bq = (fn) => output(this.bqHelper(capture(fn))); const basename = this.basenameHelper;",
      plugins: [includeDataPlugin],
    });

    const compileBase = this.compile;
    this.compile = ((template, options) => {
      this.#assertExpressionSyntax(template);
      return compileBase.call(this, template, options);
    }) as typeof this.compile;

    // `template` is a name string for render()/include(), a compiled function
    // for renderString() — only named renders carry a name to transform.
    if (transformRender) {
      const renderBase = this.render;
      this.render = ((template, data, meta) => {
        const out = renderBase.call(this, template, data, meta);
        return typeof template === "string"
          ? transformRender(template, out)
          : out;
      }) as typeof this.render;

      const renderAsyncBase = this.renderAsync;
      this.renderAsync = ((template, data, meta) =>
        renderAsyncBase
          .call(this, template, data, meta)
          .then((out) =>
            typeof template === "string" ? transformRender(template, out) : out,
          )) as typeof this.renderAsync;
    }
  }

  define(name: string, source: string): void {
    if (name === "") throw new EtaError("Template name is empty");
    const compiledSync = this.compile(source);
    const compiledAsync = this.compile(source, { async: true });
    this.#sources.set(name, source);
    this.templatesSync.define(name, compiledSync);
    this.templatesAsync.define(name, compiledAsync);
  }

  remove(name: string): void {
    this.#sources.delete(name);
    this.templatesSync.remove(name);
    this.templatesAsync.remove(name);
  }

  /** Drop every defined template and clear compiled caches. */
  reset(): void {
    this.#sources.clear();
    this.templatesSync.reset();
    this.templatesAsync.reset();
  }

  setAutoTrim(autoTrim: readonly [AutoTrim, AutoTrim]): void {
    this.config.autoTrim = [...autoTrim] as [AutoTrim, AutoTrim];
    this.templatesSync.reset();
    this.templatesAsync.reset();
    for (const [name, source] of this.#sources) {
      this.templatesSync.define(name, this.compile(source));
      this.templatesAsync.define(name, this.compile(source, { async: true }));
    }
  }

  /**
   * @throws EtaParseError when an interpolation/raw expression contains invalid
   *   JavaScript.
   */
  #assertExpressionSyntax(template: string): void {
    let searchFrom = 0;
    for (const node of this.parse(template)) {
      if (typeof node !== "object" || (node.t !== "i" && node.t !== "r")) {
        continue;
      }

      const index = template.indexOf(node.val, searchFrom);
      if (index !== -1) searchFrom = index + node.val.length;

      try {
        // oxlint-disable-next-line no-implied-eval
        new Function(`return (${node.val}\n);`);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        throw new EtaParseError(
          pointToSyntaxError(
            template,
            index === -1 ? searchFrom : index,
            `Bad expression — ${error.message}`,
          ),
        );
      }
    }
  }
}

export { basename } from "./basename";

function pointToSyntaxError(
  source: string,
  index: number,
  message: string,
): string {
  const before = source.slice(0, index).split("\n");
  const line = before.length;
  const col = before[before.length - 1]!.length + 1;
  const sourceLine = source.split("\n")[line - 1] ?? "";
  return `${message} at line ${line} col ${col}:\n\n  ${sourceLine}\n  ${" ".repeat(col - 1)}^`;
}

/**
 * eta-4 spreads `include()` data into the parent object; v1 templates pass
 * arrays through `include()`, so restore direct passthrough of the data arg.
 * Host-agnostic — the Obsidian managed-region wrap is the engine's
 * `transformRender` render override, not a plugin.
 *
 * Both `include` and `includeAsync` are rewritten: eta emits both helpers into
 * every compiled template regardless of render path, so leaving the async one
 * raw would silently reintroduce the spread bug on any `renderAsync` path.
 *
 * This is the engine's only `processFnString`, and the one irreducible
 * coupling to eta: the data spread happens inside the generated `include`
 * arrow before `render` runs, so it cannot be fixed by the render override —
 * only by rewriting the generated source. The patterns match eta's own
 * codegen (not another plugin's output) and are pinned to a specific eta
 * version. `replaceHelper` throws when a target is absent, so an eta-upgrade
 * codegen change fails loud at compile time instead of silently no-op'ing.
 * @see eta@4.6.0 `src/compile-string.ts` (the `compileToString` helper block)
 */
const includeDataPlugin: EtaConfig["plugins"][number] = {
  processFnString(fnString, config) {
    const varName = config?.varName ?? "it";
    const synced = replaceHelper(
      fnString,
      `let include = (__eta_t, __eta_d) => this.render(__eta_t, {...${varName}, ...(__eta_d ?? {})}, options);`,
      `let include = (__eta_t, __eta_d) => this.render(__eta_t, __eta_d ?? ${varName}, options);`,
    );
    return replaceHelper(
      synced,
      `let includeAsync = (__eta_t, __eta_d) => this.renderAsync(__eta_t, {...${varName}, ...(__eta_d ?? {})}, options);`,
      `let includeAsync = (__eta_t, __eta_d) => this.renderAsync(__eta_t, __eta_d ?? ${varName}, options);`,
    );
  },
};

export function formatBlockquote(content: string): string {
  const lines = content
    .trim()
    .split("\n")
    .map((line) => (line.trim() === "" ? ">" : `> ${line}`));
  return lines
    .filter((line, i) => !(line === ">" && lines[i - 1] === ">"))
    .join("\n");
}

function filterUndefinedNull(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Temporal.Instant) {
    return value
      .toZonedDateTimeISO(Temporal.Now.timeZoneId())
      .toPlainDate()
      .toString();
  }
  // Coercing arbitrary values via their `toString` is this filter's job — e.g.
  // ItemDate / creators carry a custom `toString`.
  // oxlint-disable-next-line no-base-to-string
  return String(value);
}

export type { TemplateFunction };
