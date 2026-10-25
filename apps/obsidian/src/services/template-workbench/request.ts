// Selector parsing: the request each command accepts, and the identity it asserts.

import { Schema } from "effect";
import type { Effect } from "effect";
import type { CliData } from "obsidian";

import { DEFAULT_CITATION_VARIANT, isIndexedKey } from "@zotlit/db";
import type { CitationVariant, ContractRoot, TemplateSlot } from "@zotlit/db";
import type { PartialContext } from "@zotlit/workbench/render";

import {
  cliDefault,
  cliLiterals,
  cliMap,
  cliNotApplicable,
  cliOneOf,
  cliParams,
  cliSwitch,
  cliText,
  cliValue,
  cliVariants,
  decodeCliParams,
  expectSourceParam,
  noCliParams,
} from "@/lib/cli-params";
import type { CliOutput, CliParamName, CliRejection } from "@/lib/cli-params";
import { isPartialNameShape } from "@/services/template/defaults";

import { diagnostic } from "./envelope";
import type { Diagnostic, WorkbenchIdentity } from "./envelope";
import { GUIDE_TOPIC_NAMES } from "./guide";
import type { GuideTopic } from "./guide";
import { CONTRACT_ROOT_NAMES } from "./schema";
import {
  choices,
  CITATION_EXAMPLE_NAMES,
  CITATION_TEMPLATE,
  CITATION_VARIANT_NAMES,
  FRONTMATTER_LANGUAGE_NAMES,
  FRONTMATTER_MERGE_NAMES,
  isPartialTemplate,
  PARTIAL_CONTEXT_NAMES,
  partialTemplateName,
  quotedList,
  RENDER_TEMPLATE_NAMES,
  TEMPLATE_SLOT_NAMES,
} from "./vocabulary";
import type { RenderTemplate } from "./vocabulary";

export {
  CITATION_EXAMPLE_NAMES,
  CITATION_VARIANT_NAMES,
  FRONTMATTER_LANGUAGE_NAMES,
  FRONTMATTER_MERGE_NAMES,
  PARTIAL_CONTEXT_NAMES,
  RENDER_TEMPLATE_NAMES,
  TEMPLATE_SLOT_NAMES,
};

const INDEXED_KEY_MESSAGE = "key must be an Indexed Key.";

/** The Indexed Key an item-backed command selects with. */
const indexedKey = indexedKeyOr(INDEXED_KEY_MESSAGE);

/** An Indexed Key, or `message` for any other text. */
function indexedKeyOr(message: string) {
  return Schema.String.check(
    Schema.makeFilter((key: string) => isIndexedKey(key) || message),
  );
}

/**
 * The key message of a selector. A Citation takes one built-in example set
 * instead, since a Citation the user has yet to insert has no Zotero object.
 */
function keyMessage(citation: boolean): string {
  return citation
    ? `key must be an Indexed Key, or select a built-in Citation with example=${choices(CITATION_EXAMPLE_NAMES)}.`
    : INDEXED_KEY_MESSAGE;
}

/** The example message of a selector that names an example it cannot take. */
function exampleMessage(citation: boolean): string {
  return citation
    ? `Select the Citation with example=${choices(CITATION_EXAMPLE_NAMES)} or with key=<indexed-key>, not both.`
    : "example selects a built-in Citation set; it applies to the citation root only. Every other root selects a Zotero object with key=<indexed-key>.";
}

/**
 * The selector of a variant that reads a Citation by an Indexed Key. The
 * caller who names only a built-in example set takes {@link citationByExample}.
 */
const citationByKey = {
  example: cliNotApplicable(exampleMessage(true)),
  key: indexedKeyOr(keyMessage(true)),
};

/** The selector of a variant that reads one built-in Citation example set. */
const citationByExample = {
  example: cliLiterals(
    CITATION_EXAMPLE_NAMES,
    `example must be ${quotedList(CITATION_EXAMPLE_NAMES)}.`,
  ),
};

const NOTE_SELECTOR_MESSAGE =
  "Select one non-empty note path, key, or Citation example.";

const dataRoot = cliLiterals(CONTRACT_ROOT_NAMES, rootVocabulary());

/** How `template-data` reads the root, after the object it reads. */
const dataReading = {
  query: Schema.optionalKey(
    cliText("query must contain text. Use query=<field name> for discovery."),
  ),
  path: Schema.optionalKey(
    cliText("path must contain text. Use query=<field name> for discovery."),
  ),
  full: cliSwitch("Use the full flag to request the complete zt object."),
  format: cliDefault(cliLiterals(["json"], "format must be 'json'."), "json"),
  "expect-source": expectSourceParam,
};

const oneReadMode = cliOneOf<{ query?: string; path?: string; full?: true }>(
  ["query", "path", "full"],
  { many: "Use one of query=<words>, path=<zt.path>, or full." },
);

/** The request every `template-data` variant decodes to. */
function dataRequest<TSelected extends object>(
  selected: TSelected,
  reading: { root: ContractRoot } & Schema.Struct<typeof dataReading>["Type"],
) {
  const { root, format, query, path, full } = reading;
  return {
    ...selected,
    root,
    format,
    ...(query === undefined ? {} : { query }),
    ...(path === undefined ? {} : { path }),
    ...(full === undefined ? {} : { full }),
  };
}

const dataParams = cliVariants(
  ({ note, root, key, example }) =>
    note !== undefined
      ? "note"
      : root !== "citation"
        ? "item"
        : key !== undefined || example === undefined
          ? "citation"
          : "citationExample",
  {
    note: cliParams(
      {
        root: dataRoot,
        note: cliText(NOTE_SELECTOR_MESSAGE),
        key: cliNotApplicable(NOTE_SELECTOR_MESSAGE),
        example: cliNotApplicable(NOTE_SELECTOR_MESSAGE),
        ...dataReading,
      },
      { root: rootVocabulary() },
    )
      .check(oneReadMode)
      .pipe(cliMap(({ note, ...reading }) => dataRequest({ note }, reading))),
    citation: cliParams(
      { root: dataRoot, ...citationByKey, ...dataReading },
      { key: keyMessage(true) },
    )
      .check(oneReadMode)
      .pipe(cliMap(({ key, ...reading }) => dataRequest({ key }, reading))),
    citationExample: cliParams({
      root: dataRoot,
      ...citationByExample,
      ...dataReading,
    })
      .check(oneReadMode)
      .pipe(
        cliMap(({ example, ...reading }) => dataRequest({ example }, reading)),
      ),
    item: cliParams(
      {
        root: dataRoot,
        example: cliNotApplicable(exampleMessage(false)),
        key: indexedKey,
        ...dataReading,
      },
      { root: rootVocabulary(), key: INDEXED_KEY_MESSAGE },
    )
      .check(oneReadMode)
      .pipe(cliMap(({ key, ...reading }) => dataRequest({ key }, reading))),
  },
);

/** What `template-data` reads: a note, a Zotero object, or a Citation set. */
export type DataRequest = CliOutput<typeof dataParams>;
export type DataParam = CliParamName<typeof dataParams>;

export function parseDataRequest(
  params: CliData,
): Effect.Effect<DataRequest, CliRejection> {
  return decodeCliParams(params, dataParams, {
    command: "template-data",
    misplaced: { template: dataCommandTemplateHint() },
  });
}

const renderTemplateMessage = `template must be ${quotedList(RENDER_TEMPLATE_NAMES)}.`;

const notPartialRoot = cliNotApplicable(
  "template-render infers the data root from template; root names the caller a partial is rendered as, on template=partial:<name> only.",
);
const notCitationVariant = cliNotApplicable(
  `variant names a Citation Variant; it applies to template=${CITATION_TEMPLATE} only.`,
);
const notCitationExample = cliNotApplicable(exampleMessage(false));

const partialTemplate = Schema.String.check(
  Schema.makeFilter(
    (input: string) =>
      (isPartialTemplate(input) &&
        isPartialNameShape(partialTemplateName(input))) ||
      "A Shared Partial name is letters, digits, and hyphens: template=partial:<name>.",
  ),
).pipe(cliMap((input) => input as `partial:${string}`));

const citationVariant = cliDefault(
  cliLiterals(
    CITATION_VARIANT_NAMES,
    `variant must be ${quotedList(CITATION_VARIANT_NAMES)}.`,
  ),
  DEFAULT_CITATION_VARIANT,
);

const renderFormat = {
  format: cliDefault(
    cliLiterals(["markdown", "json"], "format must be 'markdown' or 'json'."),
    "json",
  ),
  "expect-source": expectSourceParam,
};

/** The request every `template-render` variant decodes to. */
function renderRequest<TSelected extends object>(
  selected: TSelected,
  reading: {
    template: RenderTemplate;
    format: "markdown" | "json";
    root?: PartialContext;
    variant?: CitationVariant;
  },
) {
  const { template, format, root, variant } = reading;
  return {
    ...selected,
    template,
    // The caller a partial render reads its data as; absent for every other Template.
    ...(root === undefined ? {} : { root }),
    // The Citation Variant a citation render names; absent for every other Template.
    ...(variant === undefined ? {} : { variant }),
    format,
  };
}

/**
 * Whether a render reads a Citation decides its variant: the Citation
 * Template, or a partial read as called from a Citation. Under every other
 * caller a partial takes the caller's own object, and only a partial has a
 * caller to choose.
 */
const renderParams = cliVariants(
  ({ template, root, key, example }) =>
    template === CITATION_TEMPLATE
      ? key !== undefined || example === undefined
        ? "citation"
        : "citationExample"
      : template === undefined || !isPartialTemplate(template)
        ? "slot"
        : root !== "citation"
          ? "partial"
          : key !== undefined || example === undefined
            ? "partialCitation"
            : "partialCitationExample",
  {
    slot: cliParams(
      {
        template: cliLiterals(TEMPLATE_SLOT_NAMES, renderTemplateMessage),
        root: notPartialRoot,
        example: notCitationExample,
        variant: notCitationVariant,
        key: indexedKey,
        ...renderFormat,
      },
      { template: renderTemplateMessage, key: INDEXED_KEY_MESSAGE },
    ).pipe(
      cliMap(({ key, template, format }) =>
        renderRequest({ key }, { template, format }),
      ),
    ),
    citation: cliParams(
      {
        template: Schema.Literal(CITATION_TEMPLATE),
        root: notPartialRoot,
        ...citationByKey,
        variant: citationVariant,
        ...renderFormat,
      },
      { key: keyMessage(true) },
    ).pipe(
      cliMap(({ key, template, variant, format }) =>
        renderRequest({ key }, { template, variant, format }),
      ),
    ),
    citationExample: cliParams({
      template: Schema.Literal(CITATION_TEMPLATE),
      root: notPartialRoot,
      ...citationByExample,
      variant: citationVariant,
      ...renderFormat,
    }).pipe(
      cliMap(({ example, template, variant, format }) =>
        renderRequest({ example }, { template, variant, format }),
      ),
    ),
    partial: cliParams(
      {
        template: partialTemplate,
        root: cliDefault(
          cliLiterals(
            PARTIAL_CONTEXT_NAMES,
            `root must be ${quotedList(PARTIAL_CONTEXT_NAMES)}.`,
          ),
          "note",
        ),
        example: notCitationExample,
        variant: notCitationVariant,
        key: indexedKey,
        ...renderFormat,
      },
      { key: INDEXED_KEY_MESSAGE },
    ).pipe(
      cliMap(({ key, template, root, format }) =>
        renderRequest({ key }, { template, root, format }),
      ),
    ),
    partialCitation: cliParams(
      {
        template: partialTemplate,
        root: Schema.Literal("citation"),
        ...citationByKey,
        variant: citationVariant,
        ...renderFormat,
      },
      { key: keyMessage(true) },
    ).pipe(
      cliMap(({ key, template, root, variant, format }) =>
        renderRequest({ key }, { template, root, variant, format }),
      ),
    ),
    partialCitationExample: cliParams({
      template: partialTemplate,
      root: Schema.Literal("citation"),
      ...citationByExample,
      variant: citationVariant,
      ...renderFormat,
    }).pipe(
      cliMap(({ example, template, root, variant, format }) =>
        renderRequest({ example }, { template, root, variant, format }),
      ),
    ),
  },
);

/** The Template `template-render` renders, and the object it reads. */
export type RenderRequest = CliOutput<typeof renderParams>;
export type RenderParam = CliParamName<typeof renderParams>;

export function parseRenderRequest(
  params: CliData,
): Effect.Effect<RenderRequest, CliRejection> {
  return decodeCliParams(params, renderParams, { command: "template-render" });
}

const notOtherDocument = cliNotApplicable(
  "Provide exactly one of profile, document, or source.",
);

const documentRenderParams = cliVariants(
  ({ profile, document, source }) =>
    profile === undefined && document !== undefined
      ? "document"
      : profile === undefined && source !== undefined
        ? "source"
        : "profile",
  {
    profile: cliParams(
      {
        profile: cliValue("profile"),
        document: notOtherDocument,
        source: notOtherDocument,
        key: indexedKey,
        "expect-source": expectSourceParam,
      },
      {
        key: INDEXED_KEY_MESSAGE,
        profile: "Provide exactly one of profile, document, or source.",
      },
    ).pipe(cliMap(({ key, profile }) => ({ key, profile }))),
    document: cliParams(
      {
        document: cliValue("document"),
        source: notOtherDocument,
        key: indexedKey,
        "expect-source": expectSourceParam,
      },
      { key: INDEXED_KEY_MESSAGE },
    ).pipe(cliMap(({ key, document }) => ({ key, document }))),
    source: cliParams(
      {
        source: cliValue("source"),
        key: indexedKey,
        "expect-source": expectSourceParam,
      },
      { key: INDEXED_KEY_MESSAGE },
    ).pipe(cliMap(({ key, source }) => ({ key, source }))),
  },
);

/** The Indexed Key, and the Profile, installed document, or source to render. */
export type DocumentRenderRequest = CliOutput<typeof documentRenderParams>;
export type DocumentRenderParam = CliParamName<typeof documentRenderParams>;

/** Select one Profile, installed document, or in-memory source override. */
export function parseDocumentRenderRequest(
  params: CliData,
): Effect.Effect<DocumentRenderRequest, CliRejection> {
  return decodeCliParams(params, documentRenderParams, {
    command: "template-document-render",
  });
}

/** A command that reads no selector at all. */
const noParams = noCliParams.pipe(cliMap(() => null));

/** `template-schema` lists every published schema and reads no selector at all. */
export function parseSchemaRequest(
  params: CliData,
): Effect.Effect<null, CliRejection> {
  return decodeCliParams(params, noParams, {
    command: "template-schema",
    misplaced: {
      key: "template-schema does not accept an item selector.",
      root: SCHEMA_LISTS_EVERY_ROOT_MESSAGE,
      template: SCHEMA_LISTS_EVERY_ROOT_MESSAGE,
    },
  });
}

const templateSlotMessage = `template must be ${quotedList(TEMPLATE_SLOT_NAMES)}.`;

const sourceParams = cliParams(
  { template: cliLiterals(TEMPLATE_SLOT_NAMES, templateSlotMessage) },
  { template: templateSlotMessage },
).pipe(cliMap((input) => input.template));

export type SourceParam = CliParamName<typeof sourceParams>;

/** `template-source` selects a Template name and reads nothing item-backed. */
export function parseSourceRequest(
  params: CliData,
): Effect.Effect<TemplateSlot, CliRejection> {
  return decodeCliParams(params, sourceParams, {
    command: "template-source",
    misplaced: {
      key: "template-source does not accept an item selector.",
      root: slotCommandRootHint(),
    },
  });
}

const guideParams = cliParams({
  topic: Schema.optionalKey(
    cliLiterals(
      GUIDE_TOPIC_NAMES,
      `topic must be ${quotedList(GUIDE_TOPIC_NAMES)}.`,
    ),
  ),
}).pipe(cliMap((input) => input.topic ?? null));

export type GuideParam = CliParamName<typeof guideParams>;

/** `template-guide` prints the quickstart when `topic` is absent. */
export function parseGuideRequest(
  params: CliData,
): Effect.Effect<GuideTopic | null, CliRejection> {
  return decodeCliParams(params, guideParams, { command: "template-guide" });
}

/** `template-status` reads no selector at all. */
export function parseStatusRequest(
  params: CliData,
): Effect.Effect<null, CliRejection> {
  return decodeCliParams(params, noParams, { command: "template-status" });
}

/** `frontmatter-status` reads no selector at all. */
export function parseFrontmatterStatusRequest(
  params: CliData,
): Effect.Effect<null, CliRejection> {
  return decodeCliParams(params, noParams, { command: "frontmatter-status" });
}

const language = cliLiterals(
  FRONTMATTER_LANGUAGE_NAMES,
  `language must be ${quotedList(FRONTMATTER_LANGUAGE_NAMES)}.`,
);

const evalTarget = {
  key: indexedKey,
  format: cliDefault(cliLiterals(["json"], "format must be 'json'."), "json"),
  "expect-source": expectSourceParam,
};

const frontmatterEvalParams = cliVariants(
  ({ expr }) => (expr === undefined ? "configured" : "adhoc"),
  {
    configured: cliParams(
      {
        language: cliNotApplicable("language requires expr."),
        ...evalTarget,
      },
      { key: INDEXED_KEY_MESSAGE },
    ).pipe(cliMap(({ key, format }) => ({ key, format, adhoc: null }))),
    adhoc: cliParams(
      {
        ...evalTarget,
        expr: Schema.String,
        language: cliDefault(language, "liquid"),
      },
      { key: INDEXED_KEY_MESSAGE },
    ).pipe(
      cliMap(({ key, format, expr, language }) => ({
        key,
        format,
        adhoc: { expr, language },
      })),
    ),
  },
);

/** `frontmatter-eval`'s parsed selector: the configured set (`adhoc: null`),
 *  or one ad-hoc expression to evaluate instead. */
export type FrontmatterEvalRequest = CliOutput<typeof frontmatterEvalParams>;
export type FrontmatterEvalParam = CliParamName<typeof frontmatterEvalParams>;

/** `frontmatter-eval` selects an Item and, with `expr=`, one ad-hoc
 *  expression to evaluate in place of the configured field set. */
export function parseFrontmatterEvalRequest(
  params: CliData,
): Effect.Effect<FrontmatterEvalRequest, CliRejection> {
  return decodeCliParams(params, frontmatterEvalParams, {
    command: "frontmatter-eval",
  });
}

/** The Managed Frontmatter field key a command names. */
const fieldKey = trimmedText("field must not be empty.");

/** Text with something beside whitespace, trimmed. */
function trimmedText(message: string) {
  return cliText(message).pipe(cliMap((text) => text.trim()));
}

const frontmatterSetParams = cliParams({
  field: fieldKey,
  expr: Schema.optionalKey(trimmedText("expr must not be empty.")),
  language: Schema.optionalKey(language),
  merge: Schema.optionalKey(
    cliLiterals(
      FRONTMATTER_MERGE_NAMES,
      `merge must be ${quotedList(FRONTMATTER_MERGE_NAMES)}.`,
    ),
  ),
}).pipe(
  cliMap(({ field, expr, language, merge }) => ({
    field,
    ...(expr !== undefined ? { expr } : {}),
    ...(language !== undefined ? { language } : {}),
    ...(merge !== undefined ? { merge } : {}),
  })),
);

/**
 * `frontmatter-set`'s parsed selector: the field key to upsert, plus whichever
 * of `expr`/`language`/`merge` the caller supplied. An absent property means
 * "omitted" — the handler resolves it against the field's current
 * configuration (patch) or a default (new field), so parsing never fills one
 * in itself.
 */
export type FrontmatterSetRequest = CliOutput<typeof frontmatterSetParams>;

export type FrontmatterSetParam = CliParamName<typeof frontmatterSetParams>;

/** `frontmatter-set` upserts one Managed Frontmatter field by key. */
export function parseFrontmatterSetRequest(
  params: CliData,
): Effect.Effect<FrontmatterSetRequest, CliRejection> {
  return decodeCliParams(params, frontmatterSetParams, {
    command: "frontmatter-set",
  });
}

const frontmatterRemoveParams = cliParams({ field: fieldKey });

/** `frontmatter-remove`'s parsed selector: the field key to delete. Whether
 *  it is actually configured is a handler concern (`FIELD_NOT_FOUND`), not a
 *  selector-level one. */
export type FrontmatterRemoveRequest = CliOutput<
  typeof frontmatterRemoveParams
>;

export type FrontmatterRemoveParam = CliParamName<
  typeof frontmatterRemoveParams
>;

/** `frontmatter-remove` deletes one Managed Frontmatter field by key. */
export function parseFrontmatterRemoveRequest(
  params: CliData,
): Effect.Effect<FrontmatterRemoveRequest, CliRejection> {
  return decodeCliParams(params, frontmatterRemoveParams, {
    command: "frontmatter-remove",
  });
}

const frontmatterReorderParams = cliParams({
  order: Schema.String.pipe(
    cliMap((order) => order.split(",").map((key) => key.trim())),
  ).check(
    Schema.makeFilter(
      (order: readonly string[]) =>
        order.every((key) => key !== "") ||
        "order must be a comma-separated list of field keys, with no empty entries.",
    ),
  ),
});

/** `frontmatter-reorder`'s parsed selector: the candidate key order, split on
 *  commas and trimmed. Whether it is an exact permutation of the configured
 *  keys is a handler concern (it needs the current configuration), not a
 *  selector-level one. */
export type FrontmatterReorderRequest = CliOutput<
  typeof frontmatterReorderParams
>;

export type FrontmatterReorderParam = CliParamName<
  typeof frontmatterReorderParams
>;

/** `frontmatter-reorder` arranges the configured Managed Frontmatter fields;
 *  `order` must list every configured key exactly once. */
export function parseFrontmatterReorderRequest(
  params: CliData,
): Effect.Effect<FrontmatterReorderRequest, CliRejection> {
  return decodeCliParams(params, frontmatterReorderParams, {
    command: "frontmatter-reorder",
  });
}

/**
 * Report the Zotero source the caller asserted when it differs from the
 * connected one, so an authoring loop stops before it reads or renders
 * against the wrong target.
 */
export function targetMismatch(
  params: CliData,
  identity: WorkbenchIdentity,
): Diagnostic | null {
  const expectedSource = params["expect-source"];
  if (expectedSource !== undefined && expectedSource !== identity.source.id) {
    return diagnostic(
      "TARGET_MISMATCH",
      `Expected Zotero source '${expectedSource}', connected to '${identity.source.id ?? "unresolved"}'.`,
      {
        target: "source",
        expected: expectedSource,
        actual: identity.source.id,
      },
    );
  }
  return null;
}

function rootVocabulary(): string {
  return `root must be ${quotedList(CONTRACT_ROOT_NAMES)}.`;
}

/** `template-source` reads a `root=` swap meant for the data-root command. */
function slotCommandRootHint(): string {
  return (
    `template-source selects a Template slot; use template=${choices(TEMPLATE_SLOT_NAMES)}. ` +
    `root=${choices(CONTRACT_ROOT_NAMES)} selects a data root, on template-data.`
  );
}

/** `template-data` reads a `template=` swap meant for a slot command. */
function dataCommandTemplateHint(): string {
  return (
    `template-data selects a data root; use root=${choices(CONTRACT_ROOT_NAMES)}. ` +
    `template=${choices(TEMPLATE_SLOT_NAMES)} selects a Template slot, on template-render or template-source.`
  );
}

/** `template-schema` reads a selector left over from its earlier per-root form. */
const SCHEMA_LISTS_EVERY_ROOT_MESSAGE =
  "template-schema takes no parameters; it answers with the schema of every data root, keyed by root under 'schemas'.";
