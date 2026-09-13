// Maps the Obsidian compiler's message data to Fluent: one Derived Fluent
// File per locale, the emitted IDs, and the typed message-ID map.

import * as AST from "@fluent/syntax";

import type {
  Declaration,
  Expression,
  Message,
  Variant,
} from "@zotlit/obsidian-i18n";
import type {
  CompiledMessage,
  MessageData,
} from "@zotlit/obsidian-i18n/compiler";

export interface FluentEmitOptions {
  /** Bundle-ID namespace the Companion selects, e.g. `"zotero."`. */
  namespace: string;
  /** Fluent ID prefix, e.g. `"zotlit"` — emitted as `zotlit-…`. */
  prefix: string;
  /** Project locale to Zotero locale directory, e.g. `{ en: "en-US" }`. */
  localeAliases: Readonly<Record<string, string>>;
}

export interface FluentEmitResult {
  /** Fluent text keyed by the Zotero locale directory name. */
  files: Map<string, string>;
  /** Every Fluent message ID the base locale defines. */
  ids: Set<string>;
  /** Source of `src/types/fluent.ts`. */
  types: string;
}

/** The "value" leaf: under a message object, the message value rather than an attribute. */
const VALUE_LEAF = "value";
const CATCHALL = Symbol("catchall");
const FLUENT_IDENTIFIER = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

/** Fluent's DATETIME takes an epoch timestamp through `L10nArgs`, so the compiler's date type narrows to a number. */
const DATETIME_INPUT_TYPE = "DatetimeInput";

type FluentTarget = { id: string; attribute: string | undefined };

type FluentMessageDraft = {
  value: AST.Pattern | null;
  attributes: AST.Attribute[];
  inputs: Map<string, string>;
  /** Whether the locale lacks a part (value or attribute) the base locale defines. */
  partial: boolean;
};

export class FluentEmitError extends Error {
  constructor(bundleId: string, detail: string) {
    super(`${detail} in message "${bundleId}"`);
  }
}

export function emitFluent(
  data: MessageData,
  { namespace, prefix, localeAliases }: FluentEmitOptions,
): FluentEmitResult {
  const files = new Map<string, string>();
  let baseIds = new Set<string>();
  let types = "";
  for (const locale of data.locales) {
    const messages = draftLocale(data.messages, locale, {
      namespace,
      prefix,
      baseLocale: data.baseLocale,
    });
    const resource = new AST.Resource(
      [...messages].map(
        ([id, draft]) =>
          new AST.Message(
            new AST.Identifier(id),
            draft.value,
            draft.attributes,
          ),
      ),
    );
    files.set(localeAliases[locale] ?? locale, AST.serialize(resource, {}));
    if (locale === data.baseLocale) {
      baseIds = new Set(messages.keys());
      types = emitTypes(messages);
    }
  }
  return { files, ids: baseIds, types };
}

function draftLocale(
  messages: CompiledMessage[],
  locale: string,
  {
    namespace,
    prefix,
    baseLocale,
  }: Pick<FluentEmitOptions, "namespace" | "prefix"> & { baseLocale: string },
): Map<string, FluentMessageDraft> {
  const drafts = new Map<string, FluentMessageDraft>();
  for (const message of messages) {
    const target = fluentTarget(message.id, namespace, prefix);
    const draft: FluentMessageDraft = drafts.get(target.id) ?? {
      value: null,
      attributes: [],
      inputs: new Map(),
      partial: false,
    };
    drafts.set(target.id, draft);
    for (const input of message.inputs) {
      draft.inputs.set(
        input.name,
        input.type === DATETIME_INPUT_TYPE ? "number" : input.type,
      );
    }
    const localeMessage = message.messages[locale];
    if (localeMessage === undefined) {
      draft.partial = true;
      continue;
    }
    const pattern = toPattern(localeMessage, message.id);
    if (target.attribute === undefined) {
      draft.value = pattern;
    } else {
      draft.attributes.push(
        new AST.Attribute(new AST.Identifier(target.attribute), pattern),
      );
    }
  }
  // Fluent falls back per message ID, never per attribute, so a message the
  // locale translates only in part is omitted whole and renders in the base
  // locale rather than with a blank attribute.
  for (const [id, draft] of drafts) {
    if (locale !== baseLocale && draft.partial) drafts.delete(id);
  }
  return drafts;
}

/**
 * `zotero.menu_item_open.label` → `zotlit-menu-item-open` with attribute
 * `label`; a trailing `value` leaf or no leaf at all names the value.
 */
function fluentTarget(
  bundleId: string,
  namespace: string,
  prefix: string,
): FluentTarget {
  const [message, ...rest] = bundleId.slice(namespace.length).split(".");
  if (message === undefined || message === "" || rest.length > 1) {
    throw new FluentEmitError(bundleId, "Unsupported message nesting");
  }
  const id = `${prefix}-${message.replaceAll("_", "-")}`;
  const attribute =
    rest[0] === undefined || rest[0] === VALUE_LEAF ? undefined : rest[0];
  for (const name of attribute === undefined ? [id] : [id, attribute]) {
    if (!FLUENT_IDENTIFIER.test(name)) {
      throw new FluentEmitError(
        bundleId,
        `Unsupported Fluent identifier "${name}"`,
      );
    }
  }
  return { id, attribute };
}

function toPattern(message: Message, bundleId: string): AST.Pattern {
  if (typeof message === "string") {
    return new AST.Pattern([new AST.TextElement(message)]);
  }
  const scope = new Scope(message.declarations, bundleId);
  const selectors =
    message.variants[0]?.matches.map((match) => match.key) ?? [];
  if (selectors.length === 0) {
    if (message.variants.length !== 1) {
      throw new FluentEmitError(
        bundleId,
        "Unsupported variant table without selectors",
      );
    }
    return scope.pattern(message.variants[0]!.pattern);
  }
  return scope.select(message.variants, selectors, 0);
}

/** One message's declarations, resolving locals inline since Fluent has none. */
class Scope {
  readonly #locals = new Map<string, Expression>();
  readonly #bundleId: string;

  constructor(declarations: Declaration[], bundleId: string) {
    this.#bundleId = bundleId;
    for (const declaration of declarations) {
      if (declaration.type === "local") {
        this.#locals.set(declaration.name, declaration.value);
      }
    }
  }

  pattern(expressions: Expression[]): AST.Pattern {
    return new AST.Pattern(
      expressions.map((expression) =>
        expression.type === "text"
          ? new AST.TextElement(expression.value)
          : new AST.Placeable(this.inline(expression)),
      ),
    );
  }

  inline(expression: Expression): AST.InlineExpression {
    switch (expression.type) {
      case "text":
      case "literal":
        return new AST.StringLiteral(expression.value);
      case "variable": {
        const local = this.#locals.get(expression.name);
        return local === undefined
          ? new AST.VariableReference(new AST.Identifier(expression.name))
          : this.inline(local);
      }
      case "formatter":
        return this.formatter(expression);
    }
  }

  formatter(
    expression: Extract<Expression, { type: "formatter" }>,
  ): AST.InlineExpression {
    const argument = this.inline(expression.argument);
    // Fluent selects CLDR plural categories from a bare number on its own.
    if (expression.name === "plural") return argument;
    const named = Object.entries(expression.options).map(([name, value]) => {
      if (value.type !== "literal") {
        throw new FluentEmitError(
          this.#bundleId,
          `Unsupported non-literal option "${name}" for ${expression.name}`,
        );
      }
      return new AST.NamedArgument(
        new AST.Identifier(name),
        literal(value.value),
      );
    });
    return new AST.FunctionReference(
      new AST.Identifier(expression.name.toUpperCase()),
      new AST.CallArguments([argument], named),
    );
  }

  select(variants: Variant[], selectors: string[], depth: number): AST.Pattern {
    if (depth === selectors.length) {
      if (variants.length !== 1) {
        throw new FluentEmitError(this.#bundleId, "Duplicate variant");
      }
      return this.pattern(variants[0]!.pattern);
    }
    const selector = selectors[depth]!;
    const groups = new Map<string | typeof CATCHALL, Variant[]>();
    for (const variant of variants) {
      const match = variant.matches.find(
        (candidate) => candidate.key === selector,
      );
      if (match === undefined) {
        throw new FluentEmitError(
          this.#bundleId,
          `Variant without a match for "${selector}"`,
        );
      }
      const key = match.type === "catchall" ? CATCHALL : match.value;
      groups.set(key, [...(groups.get(key) ?? []), variant]);
    }
    if (!groups.has(CATCHALL)) {
      throw new FluentEmitError(
        this.#bundleId,
        `Missing catch-all for selector "${selector}"`,
      );
    }
    // A table with only the catch-all row is a plain pattern; a `local`
    // declared for formatting alone arrives in this shape.
    if (groups.size === 1) {
      return this.select(groups.get(CATCHALL)!, selectors, depth + 1);
    }
    return new AST.Pattern([
      new AST.Placeable(
        new AST.SelectExpression(
          this.inline({ type: "variable", name: selector }),
          [...groups].map(
            ([key, rows]) =>
              new AST.Variant(
                key === CATCHALL
                  ? new AST.Identifier("other")
                  : variantKey(key, this.#bundleId),
                this.select(rows, selectors, depth + 1),
                key === CATCHALL,
              ),
          ),
        ),
      ),
    ]);
  }
}

function literal(value: string): AST.Literal {
  return isNumeric(value)
    ? new AST.NumberLiteral(value)
    : new AST.StringLiteral(value);
}

function variantKey(
  value: string,
  bundleId: string,
): AST.Identifier | AST.NumberLiteral {
  if (isNumeric(value)) return new AST.NumberLiteral(value);
  if (!FLUENT_IDENTIFIER.test(value)) {
    throw new FluentEmitError(bundleId, `Unsupported variant key "${value}"`);
  }
  return new AST.Identifier(value);
}

function isNumeric(value: string): boolean {
  return /^-?\d+(?:\.\d+)?$/.test(value);
}

function emitTypes(messages: ReadonlyMap<string, FluentMessageDraft>): string {
  const entries = [...messages]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([id, draft]) => {
      const inputs = [...draft.inputs].map(
        ([name, type]) => `${name}: ${type}`,
      );
      const shape = inputs.length === 0 ? "never" : `{ ${inputs.join("; ")} }`;
      return `  ${JSON.stringify(id)}: ${shape};`;
    });
  return [
    "// GENERATED by scripts/inlang-fluent.ts — DO NOT EDIT.",
    "// Source of truth: the `zotero` namespace in messages/{locale}.json",
    "",
    "/** Fluent message ID to its inputs; `never` marks a message that takes none. */",
    "export type FluentMessages = {",
    ...entries,
    "};",
    "",
    "export type FluentMessageId = keyof FluentMessages;",
    "",
  ].join("\n");
}
