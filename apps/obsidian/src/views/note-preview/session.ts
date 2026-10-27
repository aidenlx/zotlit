// One native render owner loads its own Item Snapshot and annotation examples.
import * as AsyncResult from "effect/reactivity/AsyncResult";

import {
  makePreviewModel,
  holdPreviewModel,
  previewStateHandle,
} from "./model";
import type { NativePreviewState, PreviewStateHandle } from "./model";
export type { NativePreviewState } from "./model";
import {
  parseLiteratureNoteTemplate,
  parsePlainTemplateDocument,
} from "@zotlit/templates/facade";
import { managedFrontmatterEntries } from "@zotlit/workbench/document";
import { CITATION_EXAMPLE_ITEM } from "@zotlit/workbench/render";
import type {
  CitationExampleId,
  PartialContext,
} from "@zotlit/workbench/render";
import type { ItemSnapshot } from "@zotlit/workbench/snapshot";
import type {
  RenderScheduler,
  WorkbenchItemChoice,
} from "@zotlit/workbench/ui";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { bibliographyRevisionAtom } from "@/services/pandoc/atoms";
import { templateRevisionAtom } from "@/services/template/atoms";
import { getSampleAnnotationParent } from "@/views/template-workbench/selection-data";
import type { TemplateAuthoringContext } from "@/views/template-workbench/view";

import { makeNativeRenderer } from "./render";
import type { NativeRenderDeps, NativeRenderResult } from "./render";

const logger = getLogger(["note-preview", "session"]);

export class NativePreviewSession implements Disposable {
  readonly state: PreviewStateHandle;
  readonly #deps: NativeRenderDeps;
  readonly #scheduler: RenderScheduler<NativeRenderResult>;
  readonly #cleanup: DisposableStack;
  readonly #renderer;

  #closed = false;
  constructor(
    deps: NativeRenderDeps,
    scheduler: RenderScheduler<NativeRenderResult>,
    options: {
      item?: WorkbenchItemChoice | null;
      state?: PreviewStateHandle;
    } = {},
  ) {
    this.#deps = deps;
    this.#scheduler = scheduler;
    const model = options.state?.model ?? makePreviewModel();
    this.state = options.state ?? previewStateHandle(deps.registry, model);
    if (options.item !== undefined) this.state.setState({ item: options.item });
    using cleanup = new DisposableStack();
    this.#renderer = cleanup.use(makeNativeRenderer(deps));
    cleanup.defer(holdPreviewModel(deps.registry, model));
    for (const atom of [templateRevisionAtom, bibliographyRevisionAtom]) {
      let previous = deps.registry.get(atom);
      cleanup.defer(
        deps.registry.subscribe(atom, (next) => {
          if (next !== previous) {
            previous = next;
            scheduler.invalidate();
          }
        }),
      );
    }
    cleanup.defer(
      this.state.subscribe((state) => {
        this.#feed();
        if (state.status === "error" && state.error)
          scheduler.fail({ code: "render-error", message: state.error });
      }),
    );
    const modify = deps.app.vault.on("modify", (file) => {
      if (file.path === scheduler.getState().result?.sourcePath)
        scheduler.invalidate();
    });
    cleanup.defer(() => deps.app.vault.offref(modify));
    cleanup.defer(this.#log());
    this.#cleanup = cleanup.move();
    this.#feed();
  }
  /** Resolves once the paper a render reads is loaded. */
  get ready(): Promise<void> {
    if (this.#closed) return Promise.resolve();
    const registry = this.#deps.registry;
    const loaded = this.state.model.loaded;
    if (!registry.get(loaded).waiting) return Promise.resolve();
    return new Promise((resolve) => {
      const unsubscribe = registry.subscribe(loaded, (result) => {
        if (!result.waiting && !AsyncResult.isInitial(result)) {
          unsubscribe();
          resolve();
        }
      });
      this.#cleanup.defer(() => {
        unsubscribe();
        resolve();
      });
    });
  }
  /** Data choice remains live even while template execution is on demand. */
  refresh(): void {
    if (!this.#closed)
      this.#deps.registry.update(
        this.state.model.refresh,
        (revision) => revision + 1,
      );
  }
  /** The authoring context the preview follows; its kind picks the root data. */
  setContext(context: TemplateAuthoringContext | null): void {
    if (this.#closed) return;
    this.state.setState({ context });
    this.#feed();
  }

  setSource(source: string): void {
    const state = this.state.getState();
    if (
      this.#closed ||
      (source === state.source && state.sourceProblem === null)
    )
      return;
    let sourceProblem: string | null = null;
    // A plain document is one source under an optional manifest: it authors no
    // Properties, so the row list a Profile carries stays empty for it.
    const plain = state.context !== null && state.context.kind !== "profile";
    let entries = plain ? [] : state.entries;
    try {
      if (plain) parsePlainTemplateDocument(source);
      else {
        parseLiteratureNoteTemplate(source);
        const list = managedFrontmatterEntries(source);
        entries = list.status === "rows" ? list.entries : [];
      }
    } catch (error) {
      sourceProblem = error instanceof Error ? error.message : String(error);
    }
    this.state.setState({ source, sourceProblem, entries });
    // A document the parser refuses is a failure, not a wait: the preview
    // names the output it kept and leads to the explanation.
    this.#scheduler.setInput({
      source,
      hold: sourceProblem !== null && "invalid",
    });
  }
  setItem(item: WorkbenchItemChoice | null): void {
    if (this.#closed || item?.id === this.state.getState().item?.id) return;
    this.state.setState({ item });
    this.refresh();
  }
  /** `output` rides along in the same store write, so a note choice lands as one change. */
  setPreview(
    value: Partial<NativePreviewState["preview"]>,
    output: Partial<
      Pick<NativePreviewState, "showManaged" | "showMarkdown">
    > = {},
  ): void {
    if (this.#closed) return;
    const preview = { ...this.state.getState().preview, ...value };
    this.state.setState({ preview, ...output });
    this.#scheduler.setInput(preview);
  }
  /**
   * The Citation set and Variant the Citation Template preview renders. An
   * example and a chosen Item are one choice: naming an example makes it the
   * set, and clearing it hands the set back to the Item.
   */
  setCitation(
    value: Partial<Pick<NativePreviewState, "variant" | "citationExample">>,
  ): void {
    if (this.#closed) return;
    this.state.setState(value);
    this.#feed();
  }

  select(id: string | null): void {
    if (this.#closed) return;
    this.state.setState({
      annotationId: id,
      ...(id !== this.state.getState().annotationId
        ? { presentation: { scrollTop: 0, reveal: null, pending: false } }
        : {}),
    });
    this.#feed();
  }
  /**
   * The scheduler decides on its own which render runs and which result the
   * reader sees; this reads its state transitions back out as the log lines a
   * diagnosis needs, so the shared package carries no logger of its own.
   */
  #log(): () => void {
    let previous = this.#scheduler.getState();
    return this.#scheduler.subscribe(() => {
      const next = this.#scheduler.getState();
      const before = previous;
      previous = next;
      if (next.busy === before.busy) return;
      if (next.busy) {
        logger.debug("Preview render started", {
          revision: this.state.getState().snapshot?.revision,
          live: this.state.getState().preview.live,
        });
      } else if (next.result !== null && next.result !== before.result) {
        logger.debug("Preview render published", {
          revision: next.result.snapshotRevision,
          diagnostics: next.result.diagnostics.length,
        });
      } else {
        logger.debug("Discarded stale preview render", {
          revision: this.state.getState().snapshot?.revision,
          closed: this.#closed,
        });
      }
    });
  }
  /**
   * The text one registered Shared Partial produces for `context`, under this
   * session's own selections. This is what a Partial Placeholder's preview
   * shows, so the box under a call reads the data the slice it sits in reads.
   *
   * @throws when no paper is chosen yet, and whatever the render raises.
   */
  async renderPartial(name: string, context: PartialContext): Promise<string> {
    await this.ready;
    const state = this.state.getState();
    const citation =
      context === "citation"
        ? { variant: state.variant, example: state.citationExample }
        : undefined;
    const snapshot = previewSnapshot(state, citation?.example ?? null);
    if (!snapshot) throw new Error(m.workbench_example_missing_item());
    return await this.#renderer.partial(
      {
        source: state.source ?? "",
        snapshot,
        ...(state.example ? { annotation: state.example } : {}),
        ...(citation ? { citation } : {}),
      },
      {
        name,
        context,
        profile: state.context?.partial?.profile ?? null,
      },
    );
  }

  /** Hands the scheduler the paper and the example every render reads. */
  #feed(): void {
    const { snapshot, example, item, context, variant, citationExample } =
      this.state.getState();
    // A Shared Partial previewed as called from a Citation reads the same set
    // a Citation Template does, so both kinds hand the scheduler one selection.
    const citationSet =
      context?.kind === "citation" ||
      (context?.kind === "partial" && context.partial?.context === "citation");
    // A Citation example carries its own citation data, so the render needs no
    // Item; the paper it cites still stamps the result the scheduler compares.
    const citation = citationSet ? { variant, example: citationExample } : null;
    this.#scheduler.setInput({
      // The editor this preview follows can hand it another Template Document,
      // and output kept for the one before it is another preview's.
      document: context?.path ?? undefined,
      citation,
      partial: context?.partial ?? null,
      snapshot: previewSnapshot(
        { snapshot, item, example },
        citation?.example ?? null,
      ),
      annotation: example,
    });
  }
  [Symbol.dispose](): void {
    logger.debug("Preview session closed", {});
    this.#closed = true;
    this.#cleanup.dispose();
  }
}

/**
 * The paper one render reads, from the session's own selections. A chosen
 * Citation example carries its own data and outranks the Item; otherwise the
 * loaded snapshot stands, and a session with no Item at all falls back to the
 * Sample Annotation's own parent.
 *
 * @param citationExample - the chosen Citation example, or null when the
 *   render is not reading a citation set.
 */
function previewSnapshot(
  state: Pick<NativePreviewState, "snapshot" | "item" | "example">,
  citationExample: CitationExampleId | null,
): ItemSnapshot | null {
  if (citationExample) return CITATION_EXAMPLE_ITEM;
  if (state.snapshot) return state.snapshot;
  return !state.item && state.example
    ? getSampleAnnotationParent(state.example.id)
    : null;
}
