// Browser-safe rendering of Workbench Item Snapshots. A connected render
// validates the selected citation style bundle here; CSL formatting stays in
// Obsidian because this preview produces the Profile's generated Markdown and
// has no bibliography or citation processor.

import { regex } from "arkregex";
import { stringify as stringifyYaml } from "yaml";

import {
  citekeysToCiteTemplateData,
  CONTRACT_VERSION,
  narrowBaseDataToCiteItemData,
  withAnnotationCitation,
} from "@zotlit/db";
import type { TemplateAnnotation } from "@zotlit/db";
import { inlineCitation, replaceSuffixMarkers } from "@zotlit/templates";
import { TemplateFacade } from "@zotlit/templates/facade";
import type { ManagedFrontmatterEntry } from "@zotlit/templates/facade";
import { evalManagedFrontmatterEntries } from "@zotlit/templates/frontmatter";
import {
  FRONTMATTER_ABSENT,
  mergeManagedFrontmatterEntries,
} from "@zotlit/templates/frontmatter-merge";
import type { EvaluatedFrontmatterField } from "@zotlit/templates/frontmatter-merge";

import type { SelectedCitationStyleResponse } from "@/bridge/contracts";
import book from "@/samples/book.json" with { type: "json" };
import conferencePaper from "@/samples/conference-paper.json" with { type: "json" };
import journalArticle from "@/samples/journal-article.json" with { type: "json" };
import thesis from "@/samples/thesis.json" with { type: "json" };
import type { ItemSnapshot } from "@/snapshot/index";

import { restoreTemplateData } from "./restore-template-data";
import { failedRender, profileSourceRevision } from "./result";
import type {
  ProfileRenderResult,
  RenderDiagnostic,
  RenderedProperty,
  RenderedRange,
} from "./result";
import type { RenderResources } from "./scheduler";

export { DEFAULT_PROFILE_SOURCE } from "./default-profile";
export { failedRender, profileSourceRevision } from "./result";
export type {
  ProfileRenderResult,
  RenderDiagnostic,
  RenderedProperty,
  RenderedRange,
  RenderIdentity,
} from "./result";
export { createRenderScheduler } from "./scheduler";
export type {
  RenderRequest,
  RenderResources,
  RenderScheduler,
  RenderSchedulerOptions,
  RenderWorkerHandle,
} from "./scheduler";
export { restoreTemplateData } from "./restore-template-data";

export const SAMPLE_ITEMS = [
  journalArticle,
  conferencePaper,
  book,
  thesis,
] as unknown as readonly ItemSnapshot[];

export function renderProfile(
  source: string,
  snapshot: ItemSnapshot,
  resources?: RenderResources,
): ProfileRenderResult {
  const identity = {
    sourceRevision: profileSourceRevision(source),
    snapshotRevision: snapshot.revision,
  };
  if (snapshot.contractVersion !== CONTRACT_VERSION) {
    return failedRender(identity, {
      code: "contract-version-mismatch",
      params: { found: snapshot.contractVersion, expected: CONTRACT_VERSION },
    });
  }

  const facade = new TemplateFacade();
  let document;
  try {
    document = facade.parseLiteratureNoteTemplate(source);
  } catch (error) {
    return failedRender(identity, {
      code: "invalid-profile",
      message: errorMessage(error),
      part: "profile",
    });
  }
  const dependencyDiagnostics: RenderDiagnostic[] = (
    resources?.dependencies.diagnostics ?? []
  ).map((diagnostic) => ({ ...diagnostic, part: "profile" }));
  // The web host renders Liquid and JSON-e only, so an Eta dependency is named
  // here rather than defined: a bundle reaches this Worker from a Local Bridge
  // outside this package, and the engine that would run it is the one this
  // host refuses.
  const bundled = resources?.dependencies.templates ?? [];
  const supported = bundled.filter(({ language }) => language === "liquid");
  const defined = new Set([
    ...supported.map(({ name }) => name),
    ...(document.manifest.partials ?? []).map(({ name }) => name),
  ]);
  const resourceDiagnostics = [
    ...dependencyDiagnostics,
    ...bundled
      .filter(({ language }) => language !== "liquid")
      .map<RenderDiagnostic>(({ name }) => ({
        code: "unsupported-dependency",
        params: { name },
        part: "profile",
      })),
    ...citationStyleDiagnostics(resources?.citationStyle),
  ];

  try {
    for (const partial of supported) {
      facade.define(partial.name, partial.source, partial.language);
    }
    for (const partial of document.manifest.partials ?? []) {
      facade.define(partial.name, partial.source, partial.language);
    }
    const note = restoreTemplateData(
      snapshot.roots.note,
      snapshot.descriptors.note,
    );
    const filenameData = restoreTemplateData(
      snapshot.roots.filename,
      snapshot.descriptors.filename,
    );
    const annotations = snapshot.roots.annotations.map((annotation, index) => {
      const descriptors = snapshot.descriptors.annotations[index];
      if (!descriptors) {
        throw new Error(`Annotation ${index} has no snapshot descriptors.`);
      }
      return withRenderedCitation(
        facade,
        restoreTemplateData(annotation, descriptors),
        defined.has(CITE_TEMPLATE),
      );
    });
    // The format is rendered on its own first, so a failure inside it is named
    // as the format's and a host can show it where the format is edited. The
    // note goes on rendering: one that never calls the format keeps its
    // preview, and one that does fails on the same fault, reported once.
    let rendered: string[] = [];
    let formatFailure: RenderDiagnostic | null = null;
    try {
      rendered = annotations.map((annotation) =>
        facade.renderLiteratureNoteTemplateAnnotation(document, annotation),
      );
    } catch (error) {
      formatFailure = {
        code: "render-error",
        message: errorMessage(error),
        part: "annotation",
      };
    }
    let creationBody: string;
    try {
      creationBody = facade.renderLiteratureNoteTemplateForCreate(
        document,
        note,
      );
    } catch (error) {
      if (!formatFailure) throw error;
      const failure = failedRender(identity, formatFailure);
      return {
        ...failure,
        diagnostics: [...resourceDiagnostics, ...failure.diagnostics],
      };
    }
    const frontmatter = evaluateFrontmatter(
      facade,
      document.manifest.frontmatter ?? [],
      note,
    );
    return {
      ...identity,
      // A preview assumes a free filename; the vault resolves collisions on save.
      filename: replaceSuffixMarkers(
        facade.renderLiteratureNoteTemplateFilename(document, filenameData),
        () => "",
      ),
      properties: frontmatter.properties,
      fold: frontmatter.fold,
      frontmatterBlock: frontmatterBlock(frontmatter.fold),
      creationBody,
      managedRegion: facade.renderLiteratureNoteTemplateForUpdate(
        document,
        note,
      ),
      annotation: rendered[0] ?? null,
      annotationRanges: locateOutputs(creationBody, rendered),
      diagnostics: [
        ...resourceDiagnostics,
        ...(formatFailure ? [formatFailure] : []),
        ...frontmatter.diagnostics,
      ],
    };
  } catch (error) {
    const failure = failedRender(identity, {
      code: "render-error",
      message: errorMessage(error),
      part: "render",
    });
    return {
      ...failure,
      diagnostics: [...resourceDiagnostics, ...failure.diagnostics],
    };
  }
}

/** The partial an annotation's page-pinned citation is rendered through. */
const CITE_TEMPLATE = "cite";

/**
 * The annotation's `citation`, produced here rather than carried in the
 * snapshot: Obsidian renders it from the parent Item with the annotation's page
 * as locator through the `cite` partial, so a preview holding that partial
 * produces the same text. A Profile whose `cite` partial is neither bundled nor
 * authored, and a parent Item with no citation key, leave the value null.
 * @see apps/obsidian/src/lib/annotation-render.ts annotationCitation
 */
function withRenderedCitation(
  facade: TemplateFacade,
  restored: Record<string, unknown>,
  hasCiteTemplate: boolean,
): object {
  const annotation = restored as unknown as TemplateAnnotation;
  return withAnnotationCitation(annotation, () => {
    const parent = annotation.parentItem;
    if (!hasCiteTemplate || !parent?.citekey) return null;
    return inlineCitation(
      facade.render(
        CITE_TEMPLATE,
        citekeysToCiteTemplateData([
          {
            citationKey: parent.citekey,
            item: narrowBaseDataToCiteItemData(parent, parent.citekey),
            label: "page",
            locator: annotation.pageLabel,
          },
        ]),
      ),
    );
  });
}

/**
 * The root element every standalone CSL style opens with, and the element a
 * processor formats through. A style carrying neither renders nothing, so the
 * bundle answers for a style the preview cannot be shown under.
 * @see apps/obsidian/src/services/pandoc/styles.ts isStandaloneCslStyle
 */
const CSL_ELEMENT_PREFIX = "(?:[^\\s/<>=:]+:)?";
const CSL_STYLE_ROOT = regex(`<${CSL_ELEMENT_PREFIX}style(?=[\\s/>])`);
const CSL_LAYOUT = regex(`<${CSL_ELEMENT_PREFIX}layout(?=[\\s/>])`);

/**
 * What the bundled Resolved CSL Style says about this render: the reason the
 * Local Bridge could not hand one over, or the content it handed over failing
 * the one check this host can make on it. CSL formatting itself stays in
 * Obsidian, so an installed style that holds together leaves no diagnostic.
 */
function citationStyleDiagnostics(
  style: SelectedCitationStyleResponse | undefined,
): RenderDiagnostic[] {
  const failure = (
    styleId: string,
    reason: string,
    parentId?: string,
  ): RenderDiagnostic[] => [
    {
      code: "citation-style-error",
      params: {
        reason,
        styleId,
        ...(parentId === undefined ? {} : { parentId }),
      },
      part: "render",
    },
  ];
  if (style?.kind === "failed") {
    return failure(
      style.styleId,
      style.reason,
      style.reason === "parent-missing" ? style.parentId : undefined,
    );
  }
  if (style?.kind !== "installed") return [];
  return CSL_STYLE_ROOT.test(style.xml) && CSL_LAYOUT.test(style.xml)
    ? []
    : failure(style.styleId, "invalid");
}

/**
 * Evaluates every authored entry against one snapshot — each on its own, none
 * reading another's result — so a row shows what it produced by itself, then
 * folds every contribution in list order into the frontmatter the note gets.
 * Every diagnostic carries the 1-based position of the entry that raised it,
 * which is how a row claims its own.
 */
function evaluateFrontmatter(
  facade: TemplateFacade,
  authored: readonly ManagedFrontmatterEntry[],
  note: object,
): {
  properties: readonly RenderedProperty[];
  fold: readonly RenderedProperty[];
  diagnostics: readonly RenderDiagnostic[];
} {
  const { compiled } = facade.compileManagedFrontmatterEntries(authored, {
    javascript: false,
  });
  const { values, errors } = evalManagedFrontmatterEntries(
    compiled,
    note,
    Temporal.Now.instant(),
  );
  const properties = values.map(rendered);
  const conflicts: EntryDiagnostic[] = [];
  const patch = mergeManagedFrontmatterEntries(values, {
    // An append that meets a value it cannot extend leaves the fold without the
    // key it produced, so the entry that produced it says so. Every compiled
    // entry stamps its own position onto what it produced, so the conflict
    // names one.
    onConflict: (key, { position, recovery }) =>
      conflicts.push({
        code: "property-append-conflict",
        params: { key },
        ...(recovery === undefined ? {} : { message: recovery }),
        part: "properties",
        position: position!,
      }),
  });
  const fold = Object.entries(patch).map(([key, value]) => ({
    key,
    ...(value === FRONTMATTER_ABSENT ? {} : { value }),
    missing: value === FRONTMATTER_ABSENT,
    // Every merged key came from one of these values, and the first entry to
    // produce one fixes where it sits in a created note. An entry whose
    // expression produced nothing contributed no such value.
    position: properties.find(
      (property) => property.key === key && !property.missing,
    )!.position,
  }));
  const diagnostics = [
    ...authored.flatMap((entry, index) =>
      "js" in entry
        ? [
            {
              code: "property-javascript" as const,
              ...(entry.key === undefined
                ? {}
                : { params: { key: entry.key } }),
              part: "properties" as const,
              position: index + 1,
            },
          ]
        : [],
    ),
    ...errors.map(({ key, position, error }) => ({
      code: "property-error" as const,
      message: errorMessage(error),
      params: { key },
      part: "properties" as const,
      position,
    })),
    ...conflicts,
  ].toSorted(byPosition);
  return { properties, fold, diagnostics };
}

/**
 * The fold as the note's own YAML block. An absent key contributes nothing to
 * the created note, so it is left out here too.
 */
function frontmatterBlock(fold: readonly RenderedProperty[]): string | null {
  const present = fold.filter(({ missing }) => !missing);
  if (present.length === 0) return null;
  return stringifyYaml(
    Object.fromEntries(present.map(({ key, value }) => [key, value])),
    { lineWidth: 0 },
  );
}

/** A property diagnostic, which always names the entry that raised it. */
type EntryDiagnostic = RenderDiagnostic & { readonly position: number };

/** List order, so the diagnostic a host reads first belongs to the first row. */
function byPosition(a: EntryDiagnostic, b: EntryDiagnostic): number {
  return a.position - b.position;
}

function rendered({
  key,
  value,
  position,
}: EvaluatedFrontmatterField): RenderedProperty {
  const missing = value === undefined || value === FRONTMATTER_ABSENT;
  // Every compiled entry stamps its own position onto what it produced.
  return { key, ...(missing ? {} : { value }), missing, position: position! };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Where each output landed in the body, searched forward in order so two
 * highlights with the same text take two places. An output the body does not
 * carry — a note that calls the format for some highlights only — is skipped,
 * and an empty output marks nothing.
 */
function locateOutputs(
  body: string,
  outputs: readonly string[],
): RenderedRange[] {
  const ranges: RenderedRange[] = [];
  let cursor = 0;
  for (const output of outputs) {
    if (output.length === 0) continue;
    const from = body.indexOf(output, cursor);
    if (from === -1) continue;
    cursor = from + output.length;
    ranges.push({ from, to: cursor });
  }
  return ranges;
}
