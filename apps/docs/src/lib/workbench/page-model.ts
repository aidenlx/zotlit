// The web Workbench on the Workbench model: the page's own atoms (the chosen
// Item's one read, the connection's state, the draft's location, the vault
// Item the page keeps) and the commands the page runs, all on the page
// runtime and in the page's registry. Closing the page disposes the registry,
// which interrupts every read and command still running.

import { Effect, Option, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";

import type { SaveSelectedProfileRequest } from "@zotlit/workbench/bridge";
import { WorkbenchDocumentController } from "@zotlit/workbench/document";
import type { WorkbenchDocumentAtoms } from "@zotlit/workbench/document";
import { DEFAULT_PROFILE_SOURCE, SAMPLE_ITEMS } from "@zotlit/workbench/render";
import type { WorkbenchReportContext } from "@zotlit/workbench/render";
import {
  annotationSamples,
  chooseAnnotation,
  chooseItem,
  createWorkbenchEditor,
  INITIAL_VIEW,
} from "@zotlit/workbench/ui";
import type {
  WorkbenchEditorInstance,
  WorkbenchHost,
  WorkbenchHostError,
  WorkbenchItemChoice,
  WorkbenchItemData,
  WorkbenchModel,
  WorkbenchViewState,
} from "@zotlit/workbench/ui";

import type { SampleItem } from "./fields";
import { Rendering } from "./rendering";
import type { PageBridge } from "./runtime";
import type { DraftLocation } from "./transfer";
import { Transfer } from "./transfer";
import { unsupportedDependencies, unsupportedProblems } from "./unsupported";
import { DEFAULT_SAMPLE, STANDALONE_LOCATION } from "./use-workbench-draft";
import { WorkbenchConnection } from "./workbench-connection";
import type { ConnectionState, SavedProfile } from "./workbench-connection";

/**
 * How the view state names a paper: a Sample Item by its key, the vault's
 * Item by its key under `connected:`.
 */
export function itemChoice(sample: SampleItem): WorkbenchItemChoice {
  return {
    id:
      sample.provenance.kind === "connected"
        ? `connected:${sample.item.key}`
        : sample.item.key,
    title: sample.item.title ?? null,
  };
}

/** Disconnect, and what the page says once it ended. */
export interface DisconnectJob {
  readonly done: () => void;
}

/** A read of the Item selected in Zotero, and what takes it. */
export interface LoadItemJob {
  readonly loaded: (sample: SampleItem) => void;
}

/** A Profile save, and what the page does once the vault answered. */
export interface SaveJob {
  readonly source: string;
  readonly saved: (profile: SavedProfile) => void;
}

/** A Profile handed to Obsidian, and what the page says when it ends. */
export interface OpenInObsidianJob {
  readonly source: string;
  readonly done: (copied: boolean) => void;
}

/** A Profile file the reader picked, and what the page does with its text. */
export interface ImportJob {
  readonly file: File;
  readonly read: (source: string) => void;
  readonly failed: () => void;
}

/** The page's atoms and commands; one page has one. */
export interface WebPage {
  readonly view: Atom.Writable<WorkbenchViewState>;
  /** The vault Item the page holds, which the paper choice offers. */
  readonly retained: Atom.Writable<SampleItem | null>;
  /** The document the draft is kept for. */
  readonly location: Atom.Writable<DraftLocation>;
  /** The chosen paper. */
  readonly chosen: Atom.Atom<SampleItem>;
  /**
   * The one read of the chosen paper, which every surface derives from. It
   * waits for `Temporal`, as restoring the paper's data does; a new choice
   * interrupts the read it replaces.
   */
  readonly read: Atom.Atom<
    AsyncResult.AsyncResult<SampleItem, WorkbenchHostError>
  >;
  readonly connection: Atom.Atom<ConnectionState>;
  /** The Profile the last hydration read, a new object each time. */
  readonly hydration: Atom.Atom<ConnectionState["hydration"]>;
  /**
   * The hydration the page has opened. Until it opens the one the connection
   * read, the draft on screen is not the one the vault's reads answer.
   */
  readonly opened: Atom.Writable<ConnectionState["hydration"]>;
  readonly reconnect: Atom.AtomResultFn<void, void, never>;
  readonly reload: Atom.AtomResultFn<void, void, never>;
  readonly disconnect: Atom.AtomResultFn<DisconnectJob, void, never>;
  /** Loads the Item selected in Zotero and hands it to `loaded`. */
  readonly loadItem: Atom.AtomResultFn<LoadItemJob, void, never>;
  readonly save: Atom.AtomResultFn<SaveJob, void, never>;
  /** The revision the text on screen descends from, which Save answers for. */
  readonly saveAgainst: Atom.AtomResultFn<
    SaveSelectedProfileRequest["expected"],
    void,
    never
  >;
  readonly openInObsidian: Atom.AtomResultFn<OpenInObsidianJob, void, never>;
  readonly importFile: Atom.AtomResultFn<ImportJob, void, never>;
}

/** The page's atoms over `bridge`. Nothing runs until something reads them. */
export function makeWebPage(bridge: PageBridge): WebPage {
  const { runtime } = bridge;
  const view = Atom.make<WorkbenchViewState>({
    ...INITIAL_VIEW,
    item: itemChoice(DEFAULT_SAMPLE),
  });
  const retained = Atom.make<SampleItem | null>(null);
  const location = Atom.make(STANDALONE_LOCATION);
  const item = Atom.map(view, (state) => state.item);
  const chosen = Atom.make((get): SampleItem => {
    const id = get(item)?.id;
    const held = get(retained);
    if (held && id === itemChoice(held).id) return held;
    return (
      SAMPLE_ITEMS.find((sample) => sample.item.key === id) ?? DEFAULT_SAMPLE
    );
  });
  const read = runtime.atom((get) => {
    const sample = get(chosen);
    return Rendering.use((rendering) => rendering.temporal).pipe(
      Effect.as(sample),
    );
  });
  const changes = runtime.atom(
    Stream.unwrap(
      WorkbenchConnection.use((service) => Effect.succeed(service.changes)),
    ),
  );
  const connection = Atom.make((get) =>
    Option.getOrElse(AsyncResult.value(get(changes)), () =>
      bridge.runSync(WorkbenchConnection.use((service) => service.current)),
    ),
  );
  return {
    view,
    retained,
    location,
    chosen,
    read,
    connection,
    hydration: Atom.map(connection, (state) => state.hydration),
    opened: Atom.make<ConnectionState["hydration"]>(null),
    reconnect: runtime.fn(() =>
      WorkbenchConnection.use((service) => service.reconnect),
    ),
    reload: runtime.fn(() =>
      WorkbenchConnection.use((service) => service.reload),
    ),
    disconnect: runtime.fn((job: DisconnectJob) =>
      WorkbenchConnection.use((service) => service.disconnect).pipe(
        Effect.andThen(Effect.sync(job.done)),
      ),
    ),
    loadItem: runtime.fn((job: LoadItemJob) =>
      WorkbenchConnection.use((service) => service.loadSelectedItem).pipe(
        Effect.flatMap((sample) =>
          sample ? Effect.sync(() => job.loaded(sample)) : Effect.void,
        ),
      ),
    ),
    save: runtime.fn((job: SaveJob) =>
      WorkbenchConnection.use((service) => service.save(job.source)).pipe(
        Effect.flatMap((saved) =>
          saved ? Effect.sync(() => job.saved(saved)) : Effect.void,
        ),
      ),
    ),
    saveAgainst: runtime.fn(
      (expected: SaveSelectedProfileRequest["expected"]) =>
        WorkbenchConnection.use((service) => service.saveAgainst(expected)),
    ),
    openInObsidian: runtime.fn((job: OpenInObsidianJob) =>
      Transfer.use((transfer) => transfer.openInObsidian(job.source)).pipe(
        Effect.match({
          onSuccess: () => job.done(true),
          onFailure: () => job.done(false),
        }),
      ),
    ),
    importFile: runtime.fn((job: ImportJob) =>
      Transfer.use((transfer) => transfer.readFile(job.file)).pipe(
        Effect.match({ onSuccess: job.read, onFailure: job.failed }),
      ),
    ),
  };
}

/** One editor of the page: the Workbench model over the page's atoms. */
export interface WebWorkbench extends Disposable {
  readonly editor: WorkbenchEditorInstance;
  readonly model: WorkbenchModel;
  /** The chosen paper's Annotations, and the one chosen among them. */
  readonly annotations: Atom.Atom<ReturnType<typeof annotationSamples>>;
  /** Chooses `sample` on every surface, keeping the Annotation where it can. */
  readonly show: (sample: SampleItem) => void;
  /** Chooses the Annotation `id` of the chosen paper on every surface. */
  readonly chooseAnnotation: (id: string | null) => void;
  /** Opens `source` as the document being edited, with a history of its own. */
  readonly load: (source: string) => void;
}

export function openWebWorkbench({
  bridge,
  page,
  host,
  reportContext,
}: {
  bridge: PageBridge;
  page: WebPage;
  host: WorkbenchHost;
  reportContext: () => WorkbenchReportContext;
}): WebWorkbench {
  const { registry, runtime } = bridge;
  // The connection as the draft on screen sees it: a hydration the page has
  // not opened yet answers a document the editor does not show.
  const settled = Atom.make((get) => get(page.hydration) === get(page.opened));
  const connected = Atom.map(page.connection, (state) => state.connection);
  const resources = Atom.map(page.connection, (state) => state.resources);
  const itemData = ({
    controller,
    document,
  }: {
    readonly controller: Atom.Atom<WorkbenchDocumentController>;
    readonly document: WorkbenchDocumentAtoms;
  }) =>
    Atom.make((get): WorkbenchItemData => {
      const problems = get(document.problems);
      const parsed = get(controller).document !== null;
      const state = get(page.connection);
      const read = get(page.read);
      const refused =
        unsupportedProblems(problems).length > 0 ||
        unsupportedDependencies(state.resources?.dependencies).length > 0;
      return {
        snapshot: Option.getOrNull(AsyncResult.value(read)),
        document: get(page.location).reference,
        resources: state.resources,
        // A Profile the web host refuses is never compiled, so nothing renders
        // it, and a bundle read for another draft would render this one against
        // the wrong partials. A paper still being read renders nothing either,
        // so the last good result stands until its own data lands.
        hold: !parsed
          ? "invalid"
          : refused ||
            state.resourcesStale ||
            !AsyncResult.isSuccess(read) ||
            read.waiting,
      };
    });
  const editor = createWorkbenchEditor({
    host,
    controller: new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE),
    registry,
    runtime,
    view: page.view,
    itemData,
    reportContext,
  });
  const model = editor.model;
  // The partials the draft calls right now. A bundle is read again only when
  // this list changes, so typing never queries the vault.
  const dependencies = runtime.atom((get) => {
    if (!get(settled)) return Effect.void;
    get(connected);
    get(resources);
    const source = get(model.document.source);
    const names = get(model.controller).dependencies.join("\u0000");
    return WorkbenchConnection.use((service) =>
      service.followDependencies({ source, names }),
    );
  });
  // The style the preview renders under: the Profile's own binding, and the
  // vault's where it binds none, which is the value Name and folder shows.
  const styleId = Atom.make((get) => {
    get(model.document.source);
    const connection = get(connected);
    const document = get(model.controller).document;
    const inherited =
      connection.state === "connected"
        ? connection.profileDefaults.citationStyle
        : null;
    return document
      ? (document.manifest.citationStyle ?? inherited)
      : undefined;
  });
  const citationStyle = runtime.atom((get) => {
    if (!get(settled)) return Effect.void;
    get(resources);
    const id = get(styleId);
    return WorkbenchConnection.use((service) =>
      service.followCitationStyle(id),
    );
  });
  const annotations = Atom.make((get) =>
    annotationSamples(
      get(page.chosen),
      get(model.choices).annotation?.id ?? null,
    ),
  );
  const choose = (sample: SampleItem, id: string | null) =>
    registry.update(
      model.choices,
      chooseAnnotation(annotationSamples(sample, id).example),
    );
  choose(registry.get(page.chosen), null);
  const releases = [
    registry.mount(dependencies),
    registry.mount(citationStyle),
    registry.mount(annotations),
  ];
  return {
    editor,
    model,
    annotations,
    show: (sample) => {
      const annotation = registry.get(model.choices).annotation?.id ?? null;
      Atom.batch(() => {
        if (sample.provenance.kind === "connected")
          registry.set(page.retained, sample);
        registry.update(page.view, chooseItem(itemChoice(sample)));
        choose(sample, annotation);
      });
    },
    chooseAnnotation: (id) => {
      choose(registry.get(page.chosen), id);
    },
    load: (source) => {
      editor.attach(new WorkbenchDocumentController(source));
    },
    [Symbol.dispose]() {
      for (const release of releases.reverse()) release();
      editor[Symbol.dispose]();
    },
  };
}
