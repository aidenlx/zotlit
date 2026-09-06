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
  compileManagedFrontmatterEntries as compileManagedFrontmatterEntriesImpl,
  evalManagedFrontmatterEntries,
  validateFrontmatterExpr as validateFrontmatterExprImpl,
} from "./frontmatter";
import type {
  CompiledFrontmatter,
  CompiledManagedFrontmatter,
} from "./frontmatter";
import { mergeManagedFrontmatterEntries } from "./frontmatter-merge";
import { TemplateEngine } from "./index";
import { createLiquidEngine } from "./liquid";
import {
  LegacyTemplateConversionError,
  LiteratureNoteTemplateError,
  parseLiteratureNoteTemplate as parseLiteratureNoteTemplateImpl,
  synthesizeLegacyLiteratureNoteTemplate,
} from "./literature-note-template";
import type {
  LegacyLiteratureNoteTemplates,
  LiteratureNoteTemplateDocument,
  ManagedFrontmatterEntry,
} from "./literature-note-template";
import { formatManagedRegion } from "./obsidian";

export type { TemplateLanguage } from "./constants";

export {
  CONVERTED_DEFAULT_PROFILE_DOCUMENT,
  convertLegacyFrontmatterFields,
  LegacyTemplateConversionError,
  literatureNoteTemplateManifestRange,
  LiteratureNoteTemplateError,
  parseLiteratureNoteTemplate,
  synthesizeLegacyLiteratureNoteTemplate,
} from "./literature-note-template";
export type {
  AnnotationSection,
  LegacyLiteratureNoteTemplates,
  LegacyTemplateConversionErrorCode,
  LiteratureNoteTemplateDocument,
  LiteratureNoteTemplateErrorCode,
  LiteratureNoteTemplateManifest,
  MatchTree,
  ManagedBlock,
  ManagedFrontmatterEntry,
  SynthesizedLiteratureNoteTemplateManifest,
} from "./literature-note-template";

export interface ConvertedLegacyLiteratureNoteTemplate {
  readonly source: string;
  readonly document: LiteratureNoteTemplateDocument;
  readonly rendered: {
    readonly create: string;
    readonly update: string;
    readonly filename: string;
    readonly annotation: string | null;
  };
  readonly frontmatterPatch: Readonly<Record<string, unknown>>;
}

export interface ConvertLegacyLiteratureNoteTemplateOptions {
  readonly frontmatter?: readonly FrontmatterField[];
  readonly javascript?: boolean;
  readonly operationTimestamp?: Temporal.Instant;
}

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
  #annotationSource: TemplateSourceOverride | undefined;

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
    const previous = this.#annotationSource;
    this.#annotationSource = undefined;
    try {
      return sourceOverride
        ? this.#renderSource(name, data, sourceOverride)
        : this.#renderByName(name, data);
    } finally {
      this.#annotationSource = previous;
    }
  }

  parseLiteratureNoteTemplate(source: string): LiteratureNoteTemplateDocument {
    return parseLiteratureNoteTemplateImpl(source);
  }

  /**
   * Synthesize and verify the default Profile document without mutating the
   * facade. Every supplied legacy output must match byte-for-byte before the
   * caller may persist the returned source.
   */
  convertLegacyLiteratureNoteTemplates(
    legacy: LegacyLiteratureNoteTemplates,
    data: {
      readonly note: object;
      readonly filename: object;
      readonly annotation?: object;
    },
    options: ConvertLegacyLiteratureNoteTemplateOptions = {},
  ): ConvertedLegacyLiteratureNoteTemplate {
    const source = synthesizeLegacyLiteratureNoteTemplate(legacy, {
      frontmatter: options.frontmatter,
    });
    const document = this.parseLiteratureNoteTemplate(source);
    const legacyRendered = {
      // The legacy path predates the trailing-line-break rule; normalize its
      // baseline so parity compares the bytes both paths would now write.
      create: withOneTrailingLineBreak(this.render("note", data.note)),
      update: this.render("content", data.note),
      filename: this.render("filename", data.filename),
      annotation:
        legacy.annotation && data.annotation
          ? this.render("annotation", data.annotation)
          : null,
    };
    const rendered = {
      create: this.renderLiteratureNoteTemplateForCreate(document, data.note),
      update: this.renderLiteratureNoteTemplateForUpdate(document, data.note),
      filename: this.renderLiteratureNoteTemplateFilename(
        document,
        data.filename,
      ),
      annotation:
        legacy.annotation && data.annotation
          ? this.renderLiteratureNoteTemplateAnnotation(
              document,
              data.annotation,
            )
          : null,
    };
    if (rendered.update === null) {
      throw new LegacyTemplateConversionError(
        "legacy-render-mismatch",
        "Converted document has no Managed Block",
        {
          difference: "update output",
          recovery: "Keep one standard content render and retry conversion.",
        },
      );
    }
    assertSameRender("create output", legacyRendered.create, rendered.create);
    assertSameRender("update output", legacyRendered.update, rendered.update);
    assertSameRender(
      "filename output",
      legacyRendered.filename,
      rendered.filename,
    );
    const frontmatter = this.compileManagedFrontmatterEntries(
      document.manifest.frontmatter ?? [],
      { javascript: options.javascript ?? false },
    );
    if (frontmatter.inertKeys.length > 0) {
      throw new LegacyTemplateConversionError(
        "legacy-frontmatter-inert",
        `Converted Managed Frontmatter requires JavaScript Templates for: ${frontmatter.inertKeys.join(", ")}`,
        {
          difference: "Managed Frontmatter gate",
          recovery:
            "Enable JavaScript Templates on this device, then retry conversion.",
          fields: frontmatter.inertKeys,
        },
      );
    }
    const evaluation = evalManagedFrontmatterEntries(
      frontmatter.compiled,
      data.note,
      options.operationTimestamp ?? Temporal.Now.instant(),
    );
    if (evaluation.errors.length > 0) {
      const keys = evaluation.errors.map(({ key }) => key).join(", ");
      throw new LegacyTemplateConversionError(
        "legacy-frontmatter-evaluation",
        `Converted Managed Frontmatter failed for: ${keys}`,
        {
          difference: "Managed Frontmatter evaluation",
          recovery: `Correct these fields, then retry conversion: ${keys}.`,
          fields: evaluation.errors.map(({ key }) => key),
        },
      );
    }
    const frontmatterPatch = mergeManagedFrontmatterEntries(evaluation.values);
    if (legacy.annotation) {
      if (legacyRendered.annotation === null || rendered.annotation === null) {
        throw new LegacyTemplateConversionError(
          "unsupported-legacy-template",
          "Annotation conversion requires verification data and an Annotation Section",
          {
            difference: "annotation verification data",
            recovery:
              "Make one Zotero annotation available, then retry conversion.",
          },
        );
      }
      assertSameRender(
        "annotation output",
        legacyRendered.annotation,
        rendered.annotation,
      );
    }
    return {
      source,
      document,
      rendered: { ...rendered, update: rendered.update },
      frontmatterPatch,
    };
  }

  /**
   * Compiles every source this document renders — the body outside its Managed
   * Block, the block itself, the Annotation Section, and the note name —
   * without evaluating any of them and without leaving anything defined, so a
   * caller can refuse a document whose text the engine cannot parse before it
   * is written anywhere. Throws the engine's own failure for the first source
   * that fails.
   */
  compileLiteratureNoteTemplate(
    document: LiteratureNoteTemplateDocument,
  ): void {
    const { language } = document.manifest;
    const block = document.managedBlock;
    const sources = [
      block
        ? document.body.slice(0, block.start) + document.body.slice(block.end)
        : document.body,
      ...(block ? [block.source] : []),
      document.annotationSection.source,
      document.manifest.filename,
    ];
    sources.forEach((source, index) => {
      // Named apart from every partial, so a compile leaves the registry as it
      // found it whatever the document calls its own templates.
      const name = `${document.manifest.id}:compile:${index}`;
      this.define(name, source, language);
      this.remove(name, language);
    });
  }

  renderLiteratureNoteTemplateForCreate<T extends object>(
    document: LiteratureNoteTemplateDocument,
    data: T,
  ): string {
    const block = document.managedBlock;
    if (!block) {
      return withOneTrailingLineBreak(
        this.#renderDocumentSource(document, data, {
          part: "body",
          source: document.body,
        }),
      );
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
    return withOneTrailingLineBreak(
      outer.replace(
        placeholder,
        () => `${formatManagedRegion(managed)}${block.trailingLineBreak}`,
      ),
    );
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

  renderLiteratureNoteTemplateAnnotation<T extends object>(
    document: LiteratureNoteTemplateDocument,
    data: T,
  ): string {
    return this.#renderDocumentSource(document, data, {
      part: "annotation",
      source: document.annotationSection.source,
    });
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

  compileManagedFrontmatterEntries(
    entries: readonly ManagedFrontmatterEntry[],
    options: { javascript: boolean },
  ): CompiledManagedFrontmatter {
    return compileManagedFrontmatterEntriesImpl(entries, {
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
    if (name === "annotation" && this.#annotationSource) {
      return this.#renderSource(name, data, this.#annotationSource);
    }
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
    {
      part,
      source,
    }: {
      part: "body" | "managed" | "annotation" | "filename";
      source: string;
    },
  ): string {
    const previous = this.#annotationSource;
    this.#annotationSource = {
      source: document.annotationSection.source,
      language: document.manifest.language,
    };
    try {
      return this.#renderSource(`${document.manifest.id}:${part}`, data, {
        source,
        language: document.manifest.language,
      });
    } finally {
      this.#annotationSource = previous;
    }
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
      if (
        !registry.has(name) &&
        !(name === "annotation" && this.#annotationSource)
      ) {
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
        const binding =
          name === "annotation" ? self.#annotationSource : undefined;
        const slot = self.#registry.get(name);
        if (!slot && !binding)
          throw new TemplateError(`Template "${name}" not found`, name);
        const templates = binding
          ? binding.language === "liquid"
            ? self.#liquid.parse(binding.source, name)
            : undefined
          : slot?.liquid;

        if (templates) {
          const out = (yield self.#liquid.renderer.renderTemplates(
            templates,
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

function assertSameRender(
  difference: string,
  legacy: string,
  converted: string,
): void {
  if (legacy === converted) return;
  let byte = 0;
  const limit = Math.min(legacy.length, converted.length);
  while (byte < limit && legacy[byte] === converted[byte]) byte += 1;
  throw new LegacyTemplateConversionError(
    "legacy-render-mismatch",
    `Converted ${difference} differs from the legacy render at byte ${byte}`,
    {
      difference,
      recovery:
        "Keep the legacy files unchanged and adjust the templates before retrying conversion.",
    },
  );
}

let nextManagedBlockPlaceholder = 0;

/**
 * Keep the established rendered-output convention separate from source splitting.
 */
function withOneTrailingLineBreak(body: string): string {
  const trimmed = body.trimEnd();
  const trailing = body.slice(trimmed.length).includes("\r\n") ? "\r\n" : "\n";
  return `${trimmed}${trailing}`;
}

function managedBlockPlaceholder(source: string): string {
  let placeholder: string;
  do {
    placeholder = `\uE000zotlit-managed-${nextManagedBlockPlaceholder}\uE001`;
    nextManagedBlockPlaceholder += 1;
  } while (source.includes(placeholder));
  return placeholder;
}
