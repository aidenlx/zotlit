// Engine facade: per-name language dispatch and cross-language includes over Liquid and Eta.

import {
  evalToken,
  Tag,
  type Context,
  type Emitter,
  type FS,
  type Liquid,
  type TagToken,
  type Template,
  type TopLevelToken,
  type ValueToken,
} from "liquidjs";

import {
  type AutoTrim,
  type FrontmatterField,
  type FrontmatterLanguage,
} from "./constants";
import {
  compileFrontmatterFields as compileFrontmatterFieldsImpl,
  validateFrontmatterExpr as validateFrontmatterExprImpl,
  type CompiledFrontmatter,
} from "./frontmatter";
import { TemplateEngine } from "./index";
import { createLiquidEngine } from "./liquid";

export type TemplateLanguage = "liquid" | "eta";

export interface TemplateFacadeOptions {
  /** Eta-only; same semantics as `TemplateEngine`. @default [false, false] */
  autoTrim?: readonly [AutoTrim, AutoTrim];
  /**
   * Post-process a named render's output, applied uniformly to both
   * languages, by direct render and by include.
   *
   * @default identity — when omitted, output passes through unchanged
   */
  transformRender?: (name: string, output: string) => string;
}

/** Facade-origin errors: a missing template, or an eta compile error labeled with its name. */
export class TemplateError extends Error {
  readonly templateName: string;

  constructor(message: string, templateName: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TemplateError";
    this.templateName = templateName;
  }
}

/** A registered template's source, keyed by language; liquid wins when both are present. */
interface TemplateSlot {
  liquid?: Template[];
  eta?: true;
}

const BRIDGE_TAG_NAME = "ztinclude";

/** Synthetic liquid source every registered name resolves to via the facade's in-memory `fs`. */
function bridgeSource(name: string): string {
  return `{% ${BRIDGE_TAG_NAME} "${name}" %}`;
}

export class TemplateFacade {
  readonly #registry = new Map<string, TemplateSlot>();
  readonly #transform: (name: string, output: string) => string;
  readonly #eta: TemplateEngine;
  readonly #liquid: Liquid;
  readonly #etaBaseRender: OmitThisParameter<TemplateEngine["render"]>;

  constructor({ autoTrim, transformRender }: TemplateFacadeOptions = {}) {
    this.#transform = transformRender ?? ((_name, output) => output);
    this.#eta = new TemplateEngine({ autoTrim, debug: true });
    this.#liquid = createLiquidEngine({ fs: this.#makeFs() });

    this.#etaBaseRender = this.#eta.render.bind(this.#eta);

    // eta's generated `include()` dispatches through `this.render` on the eta
    // instance (a dynamic lookup, not a captured closure) — overriding it
    // here routes every eta-side include back through the facade's dispatch.
    // A `TemplateFunction` arg (renderString-style calls) is not a named
    // render, so it bypasses the facade and falls through to the base method
    // untouched. `renderAsync`/`includeAsync` are deliberately not
    // intercepted: the facade's public surface is sync-only `render()`, so
    // there's no async entry point that could reach them.
    this.#eta.render = ((template, data, meta) =>
      typeof template === "string"
        ? this.#renderByName(template, data)
        : this.#etaBaseRender(
            template,
            data,
            meta,
          )) as TemplateEngine["render"];

    this.#liquid.registerTag(BRIDGE_TAG_NAME, this.#createBridgeTag());
  }

  define(name: string, source: string, language: TemplateLanguage): void {
    if (language === "eta") {
      try {
        this.#eta.define(name, source);
      } catch (error) {
        throw new TemplateError(`${name}: ${(error as Error).message}`, name, {
          cause: error,
        });
      }
      this.#registry.set(name, { ...this.#registry.get(name), eta: true });
    } else {
      // Parsed with `name` as the filepath, so every later parse/render
      // error liquidjs throws for this template is labeled `file:<name>`.
      const tpls = this.#liquid.parse(source, name);
      this.#registry.set(name, { ...this.#registry.get(name), liquid: tpls });
    }
  }

  remove(name: string, language: TemplateLanguage): void {
    const slot = this.#registry.get(name);
    if (!slot) return;

    if (language === "eta") {
      this.#eta.remove(name);
      const { eta: _eta, ...rest } = slot;
      this.#setOrDelete(name, rest);
    } else {
      const { liquid: _liquid, ...rest } = slot;
      this.#setOrDelete(name, rest);
    }
  }

  /** Drop every defined template and clear compiled caches. */
  reset(): void {
    this.#registry.clear();
    this.#eta.reset();
  }

  render<T extends object>(name: string, data: T): string {
    return this.#renderByName(name, data);
  }

  /** Eta engine only — same semantics as `TemplateEngine#setAutoTrim`. */
  setAutoTrim(autoTrim: readonly [AutoTrim, AutoTrim]): void {
    this.#eta.setAutoTrim(autoTrim);
  }

  /**
   * Compiles Managed Frontmatter fields against the facade's shared Liquid
   * engine, so `"liquid"`-language fields see the same tag/filter vocabulary
   * as the templates (e.g. `note_links`, `collection_paths`).
   */
  compileFrontmatterFields(
    fields: readonly FrontmatterField[],
    options: { javascript: boolean },
  ): CompiledFrontmatter {
    return compileFrontmatterFieldsImpl(fields, {
      ...options,
      liquid: this.#liquid,
    });
  }

  validateFrontmatterExpr(
    expr: string,
    language: FrontmatterLanguage,
  ): string | null {
    return validateFrontmatterExprImpl(expr, language, this.#liquid);
  }

  #setOrDelete(name: string, slot: TemplateSlot): void {
    if (slot.liquid || slot.eta) this.#registry.set(name, slot);
    else this.#registry.delete(name);
  }

  /**
   * Single dispatch point for every named render: direct `render()`, an eta
   * include (via the overridden `this.#eta.render`), and a bridge-tag include
   * whose target resolves to eta. Liquid-target includes render via the
   * bridge tag's own `renderTemplates` call instead (see
   * {@link TemplateFacade.#createBridgeTag}), reusing the childCtx the native
   * `{% render %}` tag already built rather than starting a fresh top-level
   * `renderSync`; both paths apply `transformRender` identically.
   */
  #renderByName(name: string, data: object): string {
    const slot = this.#registry.get(name);
    if (!slot) throw new TemplateError(`Template "${name}" not found`, name);

    const out = slot.liquid
      ? (this.#liquid.renderSync(slot.liquid, { zt: data }) as string)
      : this.#etaBaseRender(name, data, { filepath: name });
    return this.#transform(name, out);
  }

  #makeFs(): FS {
    const registry = this.#registry;
    const exists = (name: string): boolean => registry.has(name);
    // Shared by readFileSync/readFile (liquidjs's `FS.exists`/`readFile` are
    // required, not optional — see fs.d.ts — so both sync and async paths
    // must be implemented, not just the sync one).
    const readSource = (name: string): string => {
      if (!exists(name)) {
        throw new TemplateError(`Template "${name}" not found`, name);
      }
      return bridgeSource(name);
    };
    return {
      existsSync: exists,
      readFileSync: readSource,
      exists: async (name) => exists(name),
      readFile: async (name) => readSource(name),
      resolve: (_dir, file, ext) => file + ext,
    };
  }

  /**
   * `{% ztinclude "<name>" %}` — the sole tag inside every synthetic partial
   * `readFileSync`/`readFile` return. Runs inside the childCtx the native
   * `{% render %}` tag already built for that partial, so `with … as`,
   * named args, and scope isolation are all native liquid behavior; this tag
   * only decides, at render time, which engine `name` now resolves to.
   */
  #createBridgeTag() {
    // oxlint-disable-next-line typescript/no-this-alias
    const self = this;

    return class BridgeTag extends Tag {
      readonly #nameToken: ValueToken;

      constructor(
        tagToken: TagToken,
        remainTokens: TopLevelToken[],
        liquid: Liquid,
      ) {
        super(tagToken, remainTokens, liquid);
        const nameToken = this.tokenizer.readValue();
        if (!nameToken) {
          throw new Error(`${BRIDGE_TAG_NAME}: missing template name`);
        }
        this.#nameToken = nameToken;
      }

      *render(
        ctx: Context,
        emitter: Emitter,
      ): Generator<unknown, void, unknown> {
        const name = (yield evalToken(this.#nameToken, ctx)) as string;
        const slot = self.#registry.get(name);
        if (!slot)
          throw new TemplateError(`Template "${name}" not found`, name);

        if (slot.liquid) {
          const out = (yield self.#liquid.renderer.renderTemplates(
            slot.liquid,
            ctx,
          )) as string;
          emitter.write(self.#transform(name, out));
        } else {
          const data = ctx.getSync(["zt"]) as object;
          emitter.write(self.#renderByName(name, data));
        }
      }
    };
  }
}
