// One native render owner loads its own Item Snapshot and annotation examples.
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";

import { parseIndexedKey } from "@zotlit/db";
import type { CitationVariant } from "@zotlit/db";
import {
  parseLiteratureNoteTemplate,
  parsePlainTemplateDocument,
} from "@zotlit/templates/facade";
import { managedFrontmatterEntries } from "@zotlit/workbench/document";
import type { ManagedEntrySource } from "@zotlit/workbench/document";
import {
  CITATION_EXAMPLE_ITEM,
  DEFAULT_CITATION_EXAMPLE,
  SAMPLE_ANNOTATIONS,
} from "@zotlit/workbench/render";
import type {
  AnnotationExample,
  CitationExampleId,
} from "@zotlit/workbench/render";
import { exportItemSnapshot } from "@zotlit/workbench/snapshot";
import type { ItemSnapshot } from "@zotlit/workbench/snapshot";
import { annotationSamples } from "@zotlit/workbench/ui";
import type {
  RenderScheduler,
  WorkbenchItemChoice,
  PreviewMode,
} from "@zotlit/workbench/ui";

import { getLogger } from "@/lib/log";
import {
  getSampleAnnotationParent,
  getSampleItem,
} from "@/views/template-workbench/selection-data";
import type { TemplateAuthoringContext } from "@/views/template-workbench/view";

import type { NativeRenderDeps, NativeRenderResult } from "./render";

const logger = getLogger(["note-preview", "session"]);

export interface NativePreviewState {
  context: TemplateAuthoringContext | null;
  annotationId: string | null;
  presentation: { scrollTop: number; reveal: string | null; pending: boolean };
  source: string | null;
  sourceProblem: string | null;
  entries: readonly ManagedEntrySource[];
  item: WorkbenchItemChoice | null;
  preview: { mode: PreviewMode; live: boolean };
  status: "empty" | "loading" | "ready" | "error";
  error: string | null;
  showMarkdown: boolean;
  showManaged: boolean;
  snapshot: ItemSnapshot | null;
  current: readonly AnnotationExample[];
  example: AnnotationExample | null;
  /** The Citation Variant a Citation Template preview renders under. */
  variant: CitationVariant;
  /**
   * The built-in Citation example set the preview renders, or null while the
   * chosen Item supplies the set instead. It outranks `item`: a reader who
   * picks an example is looking at the example, whichever Item is selected.
   */
  citationExample: CitationExampleId | null;
}
const EMPTY_PREVIEW: NativePreviewState = {
  context: null,
  annotationId: null,
  presentation: { scrollTop: 0, reveal: null, pending: false },
  source: null,
  sourceProblem: null,
  entries: [],
  item: null,
  preview: { mode: "create", live: true },
  status: "empty",
  error: null,
  showMarkdown: false,
  showManaged: false,
  snapshot: null,
  current: [],
  example: null,
  variant: "main",
  citationExample: DEFAULT_CITATION_EXAMPLE,
};
export const createNativePreviewStore = () =>
  createStore<NativePreviewState>(() => ({ ...EMPTY_PREVIEW }));

export class NativePreviewSession implements Disposable {
  readonly state: StoreApi<NativePreviewState>;
  readonly #deps: NativeRenderDeps;
  readonly #scheduler: RenderScheduler<NativeRenderResult>;
  readonly #cleanup: DisposableStack;
  #dataGeneration = 0;
  #loading: Promise<void>;
  #closed = false;
  constructor(
    deps: NativeRenderDeps,
    scheduler: RenderScheduler<NativeRenderResult>,
    options: {
      item?: WorkbenchItemChoice | null;
      state?: StoreApi<NativePreviewState>;
    } = {},
  ) {
    this.#deps = deps;
    this.#scheduler = scheduler;
    this.state = options.state ?? createNativePreviewStore();
    if (options.item !== undefined) this.state.setState({ item: options.item });
    using cleanup = new DisposableStack();
    cleanup.defer(deps.db.on("changed", () => this.refresh()));
    cleanup.defer(
      deps.templates.on("compile-status-changed", () => scheduler.invalidate()),
    );
    cleanup.defer(
      deps.bibliographyRender.on("invalidated", () => scheduler.invalidate()),
    );
    const modify = deps.app.vault.on("modify", (file) => {
      if (file.path === scheduler.getState().result?.sourcePath)
        scheduler.invalidate();
    });
    cleanup.defer(() => deps.app.vault.offref(modify));
    cleanup.defer(this.#log());
    this.#cleanup = cleanup.move();
    this.#loading = this.#loadSnapshot();
  }
  /** Resolves once the paper a render reads is loaded. */
  get ready(): Promise<void> {
    return this.#loading;
  }
  /** Data choice remains live even while template execution is on demand. */
  refresh(): void {
    if (!this.#closed) this.#loading = this.#loadSnapshot();
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
    this.#scheduler.setInput({ source, hold: sourceProblem !== null });
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
    const { snapshot, item } = this.state.getState();
    if (snapshot) this.state.setState(annotationSamples(snapshot, id));
    else if (!item)
      this.state.setState({
        example: SAMPLE_ANNOTATIONS.find((sample) => sample.id === id) ?? null,
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
      citation,
      partial: context?.partial ?? null,
      snapshot:
        (citation?.example ? CITATION_EXAMPLE_ITEM : null) ??
        snapshot ??
        (!item && example ? getSampleAnnotationParent(example.id) : null),
      annotation: example,
    });
  }
  async #loadSnapshot(): Promise<void> {
    const generation = ++this.#dataGeneration;
    logger.debug("Loading preview data", {
      generation,
      item: this.state.getState().item?.id,
    });
    this.state.setState({
      snapshot: null,
      current: [],
      example: !this.state.getState().item
        ? (SAMPLE_ANNOTATIONS.find(
            ({ id }) => id === this.state.getState().annotationId,
          ) ?? null)
        : null,
      error: null,
      status: this.state.getState().item ? "loading" : "empty",
    });
    this.#feed();
    const item = this.state.getState().item;
    if (!item || this.#closed) return;
    try {
      let snapshot = getSampleItem(item.id);
      if (!snapshot) {
        const parsed = item.id.startsWith("sample:")
          ? null
          : parseIndexedKey(item.id);
        if (!parsed) {
          this.state.setState({ status: "error" });
          return;
        }
        using lease = await this.#deps.db.acquireRead();
        if (generation !== this.#dataGeneration || this.#closed) return;
        snapshot = exportItemSnapshot(
          lease.client,
          {
            key: parsed.key,
            library:
              parsed.groupID === null
                ? { type: "personal" }
                : { type: "group", groupID: parsed.groupID },
          },
          {
            provenance: {
              kind: "connected",
              installationId: "obsidian",
              vault: "preview",
            },
          },
        );
      }
      if (generation !== this.#dataGeneration || this.#closed) {
        logger.debug("Discarded stale preview data", {
          generation,
          current: this.#dataGeneration,
          closed: this.#closed,
        });
        return;
      }
      logger.debug("Preview data loaded", {
        generation,
        revision: snapshot.revision,
      });
      this.state.setState({
        snapshot,
        status: "ready",
        ...annotationSamples(snapshot, this.state.getState().annotationId),
      });
      this.#feed();
    } catch (error) {
      if (generation !== this.#dataGeneration || this.#closed) return;
      logger.debug("Preview data failed", { error, item: item.id });
      this.state.setState({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      this.#scheduler.fail({
        code: "render-error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  [Symbol.dispose](): void {
    logger.debug("Preview session closed", {
      dataGeneration: this.#dataGeneration,
    });
    this.#closed = true;
    this.#dataGeneration++;
    this.#cleanup.dispose();
  }
}
