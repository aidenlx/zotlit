// Engine facade: per-name language dispatch and cross-language includes over Liquid and Eta.

import { evalToken, Tag } from "liquidjs";
import type {
  Context,
  Emitter,
  FS,
  Liquid,
  TagToken,
  Template,
  TopLevelToken,
  ValueToken,
} from "liquidjs";

import type {
  AutoTrim,
  FrontmatterField,
  FrontmatterLanguage,
  TemplateLanguage,
} from "./constants";
import {
  compileFrontmatterFields as compileFrontmatterFieldsImpl,
  validateFrontmatterExpr as validateFrontmatterExprImpl,
} from "./frontmatter";
import type { CompiledFrontmatter } from "./frontmatter";
import { TemplateEngine } from "./index";
import { createLiquidEngine } from "./liquid";
import {
  LiteratureNoteTemplateError,
  parseLiteratureNoteTemplate as parseLiteratureNoteTemplateImpl,
} from "./literature-note-template";
import type { LiteratureNoteTemplateDocument } from "./literature-note-template";
import { formatManagedRegion } from "./obsidian";

export type { TemplateLanguage } from "./constants";

export { LiteratureNoteTemplateError } from "./literature-note-template";
export type {
  LiteratureNoteTemplateDocument,
  LiteratureNoteTemplateErrorCode,
  LiteratureNoteTemplateManifest,
  ManagedBlock,
} from "./literature-note-template";

/** One root-variable read found by static analysis of a registered Liquid template. */
export interface RootVariableUse {
  /** Root segment of the variable path, e.g. `"title"` for `{{ title.x }}`. */
  name: string;
  /** Full dotted path as read, e.g. `"title.x"`. */
  path: string;
  /** 1-based source position of the read: `row` is the line, `col` the column. */
  row: number;
  col: number;
}

export interface TemplateSourceOverride {
  source: string;
  language: TemplateLanguage;
}

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

/**
 * Renders named templates across Liquid and Eta from one registry, dispatching
 * per name to whichever language defined it. When both languages define the
 * same name, Liquid wins (see {@link TemplateSlot}). Every include — Liquid via
 * the in-memory `fs` bridge, Eta via the `render` override — routes back through
 * a single dispatch point, so mixed-language template sets compose, and
 * `transformRender` applies uniformly to direct and include renders alike.
 *
 * The public surface is sync-only (`render`); Eta's `renderAsync`/`includeAsync`
 * are deliberately not intercepted, since no async entry point can reach them.
 */
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

  render<T extends object>(
    name: string,
    data: T,
    sourceOverride?: TemplateSourceOverride,
  ): string {
    return sourceOverride
      ? this.#renderSource(name, data, sourceOverride)
      : this.#renderByName(name, data);
  }

  parseLiteratureNoteTemplate(source: string): LiteratureNoteTemplateDocument {
    return parseLiteratureNoteTemplateImpl(source);
  }

  renderLiteratureNoteTemplateForCreate<T extends object>(
    document: LiteratureNoteTemplateDocument,
    data: T,
  ): string {
    const block = document.managedBlock;
    if (!block) {
      return this.#renderDocumentSource(document, data, {
        part: "body",
        source: document.body,
      });
    }

    const outerSourceWithoutPlaceholder =
      document.body.slice(0, block.start) + document.body.slice(block.end);
    const placeholder = managedBlockPlaceholder(outerSourceWithoutPlaceholder);
    const outerSource =
      document.body.slice(0, block.start) +
      placeholder +
      document.body.slice(block.end);
    const outer = this.#renderDocumentSource(document, data, {
      part: "body",
      source: outerSource,
    });
    const firstPlaceholder = outer.indexOf(placeholder);
    if (
      firstPlaceholder === -1 ||
      firstPlaceholder !== outer.lastIndexOf(placeholder)
    ) {
      throw new LiteratureNoteTemplateError(
        "invalid-managed-block",
        "Managed Block must render exactly once in the document body",
        {
          recovery:
            "Place the Managed Block at the top level, outside conditionals and loops.",
        },
      );
    }
    const managed = this.#renderDocumentSource(document, data, {
      part: "managed",
      source: block.source,
    });
    return outer.replace(placeholder, () => formatManagedRegion(managed));
  }

  renderLiteratureNoteTemplateForUpdate<T extends object>(
    document: LiteratureNoteTemplateDocument,
    data: T,
  ): string | null {
    if (!document.managedBlock) return null;
    const managed = this.#renderDocumentSource(document, data, {
      part: "managed",
      source: document.managedBlock.source,
    });
    return formatManagedRegion(managed);
  }

  renderLiteratureNoteTemplateFilename<T extends object>(
    document: LiteratureNoteTemplateDocument,
    data: T,
  ): string {
    return this.#renderDocumentSource(document, data, {
      part: "filename",
      source: document.manifest.filename,
    });
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

  /**
   * Statically analyzes a registered Liquid template's own source and
   * reports every root-level variable read (including `zt` — callers
   * filter). Analysis does not traverse `{% render %}`/`{% include %}`
   * partials: the facade's in-memory `fs` returns synthetic bridge sources
   * for those, not the partial's real content; an included template's own
   * reads are found by calling this method with that template's name.
   *
   * @returns `null` when `name` is unregistered, or registered as Eta only;
   *   otherwise every root-variable read found in the template's own source.
   */
  analyzeRootVariables(name: string): RootVariableUse[] | null {
    const slot = this.#registry.get(name);
    if (!slot?.liquid) return null;

    const { globals } = this.#liquid.analyzeSync(slot.liquid, {
      partials: false,
    });
    const uses: RootVariableUse[] = [];
    for (const entries of Object.values(globals)) {
      for (const entry of entries) {
        // Segments are strings/numbers for a plain dotted path, or a nested
        // `Variable` for a computed subscript (e.g. `x[y]`); `String(...)`
        // stringifies a nested `Variable` through its own `toString`.
        const segments = entry.segments;
        uses.push({
          name: String(segments[0]),
          path: segments.map((segment) => String(segment)).join("."),
          row: entry.location.row,
          col: entry.location.col,
        });
      }
    }
    return uses;
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

  #renderSource(
    name: string,
    data: object,
    { source, language }: TemplateSourceOverride,
  ): string {
    if (language === "liquid") {
      const templates = this.#liquid.parse(source, name);
      const out = this.#liquid.renderSync(templates, { zt: data }) as string;
      return this.#transform(name, out);
    }

    let template;
    try {
      template = this.#eta.compile(source);
    } catch (error) {
      throw new TemplateError(`${name}: ${(error as Error).message}`, name, {
        cause: error,
      });
    }
    const out = this.#etaBaseRender(template, data, { filepath: name });
    return this.#transform(name, out);
  }

  #renderDocumentSource(
    document: LiteratureNoteTemplateDocument,
    data: object,
    { part, source }: { part: "body" | "managed" | "filename"; source: string },
  ): string {
    return this.render(`${document.manifest.id}:${part}`, data, {
      source,
      language: document.manifest.language,
    });
  }

  /**
   * In-memory `fs` every liquid `{% render %}` / `{% include %}` resolves
   * through. `readSource` is the single existence authority: `existsSync` and
   * `exists` answer `true` for every name, so `Loader.lookup` always reaches
   * `readFileSync`, and an unregistered target fails with a named
   * {@link TemplateError} instead of liquidjs's own unstructured
   * `ENOENT: Failed to lookup "<name>" in "<roots>"` message.
   *
   * @see liquidjs 10.27.1 `Loader.lookup` — returns the first candidate its
   *   `exists` check accepts, then the parser reads it through `readFileSync`.
   */
  #makeFs(): FS {
    const registry = this.#registry;
    // Shared by readFileSync/readFile (liquidjs's `FS.exists`/`readFile` are
    // required, not optional — see fs.d.ts — so both sync and async paths
    // must be implemented, not just the sync one).
    const readSource = (name: string): string => {
      if (!registry.has(name)) {
        throw new TemplateError(`Template "${name}" not found`, name);
      }
      return bridgeSource(name);
    };
    return {
      existsSync: () => true,
      readFileSync: readSource,
      exists: async () => true,
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

let nextManagedBlockPlaceholder = 0;

function managedBlockPlaceholder(source: string): string {
  let placeholder: string;
  do {
    placeholder = `\uE000zotlit-managed-${nextManagedBlockPlaceholder}\uE001`;
    nextManagedBlockPlaceholder += 1;
  } while (source.includes(placeholder));
  return placeholder;
}
