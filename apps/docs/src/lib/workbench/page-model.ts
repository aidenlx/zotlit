// The web Workbench on the Workbench model: the page's own atoms (the chosen
// Item's one read, the connection's state, the draft's location, the vault
// Item the page keeps), the one editor the page opens, and the commands the
// page runs, all on the page runtime and in the page's registry. Closing the
// page disposes the registry, which interrupts every read and command still
// running.

import { Effect, Option, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";

import type { SaveSelectedProfileRequest } from "@zotlit/workbench/bridge";
import { WorkbenchDocumentController } from "@zotlit/workbench/document";
import { DEFAULT_PROFILE_SOURCE, SAMPLE_ITEMS } from "@zotlit/workbench/render";
import type { WorkbenchReportContext } from "@zotlit/workbench/render";
import {
  annotationSamples,
  chooseAnnotation,
  chooseItem,
  createWorkbenchEditor,
  INITIAL_VIEW,
  patch,
} from "@zotlit/workbench/ui";
import type {
  WorkbenchEditorInstance,
  WorkbenchHostError,
  WorkbenchItemChoice,
  WorkbenchItemData,
  WorkbenchItemDataInput,
  WorkbenchModel,
  WorkbenchViewState,
} from "@zotlit/workbench/ui";

import { toast } from "@/components/ui/toast";
import { m } from "@/paraglide/messages.js";

import type { SampleItem } from "./fields";
import { matchData } from "./host";
import { Rendering } from "./rendering";
import type { PageBridge } from "./runtime";
import type { DraftLocation } from "./transfer";
import { Transfer } from "./transfer";
import { unsupportedDependencies, unsupportedProblems } from "./unsupported";
import { DEFAULT_SAMPLE, STANDALONE_LOCATION } from "./use-workbench-draft";
import { WorkbenchConnection } from "./workbench-connection";
import type { ConnectionState, SavedProfile } from "./workbench-connection";

/** Which paper a choice names: a bundled Sample Item, or the vault's Item. */
export interface Paper {
  readonly source: "sample" | "vault";
  readonly key: string;
}

export function paperOf(sample: SampleItem): Paper {
  return {
    source: sample.provenance.kind === "connected" ? "vault" : "sample",
    key: sample.item.key,
  };
}

/** The paper as the view state names its Item. */
export function itemChoice(sample: SampleItem): WorkbenchItemChoice {
  const { source, key } = paperOf(sample);
  return {
    id: JSON.stringify([source, key]),
    title: sample.item.title ?? null,
  };
}

/** A Profile save, and what the page does once the vault answered. */
export interface SaveJob {
  readonly source: string;
  readonly saved: (profile: SavedProfile) => void;
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
  /** The page's one editor, made once for the page's lifetime. */
  readonly workbench: Atom.Atom<WebWorkbench>;
  readonly reconnect: Atom.AtomResultFn<void, void, never>;
  readonly reload: Atom.AtomResultFn<void, void, never>;
  readonly disconnect: Atom.AtomResultFn<void, void, never>;
  readonly save: Atom.AtomResultFn<SaveJob, void, never>;
  /** The revision the text on screen descends from, which Save answers for. */
  readonly saveAgainst: Atom.AtomResultFn<
    SaveSelectedProfileRequest["expected"],
    void,
    never
  >;
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
  const item = Atom.map(view, (state) => state.item);
  const chosen = Atom.make((get): SampleItem => {
    const id = get(item)?.id;
    const held = get(retained);
    if (held && id === itemChoice(held).id) return held;
    return (
      SAMPLE_ITEMS.find((sample) => itemChoice(sample).id === id) ??
      DEFAULT_SAMPLE
    );
  });
  // The state now, then each state that replaces it.
  const connection = Atom.map(
    runtime.atom(
      Stream.unwrap(
        WorkbenchConnection.use((service) =>
          Effect.map(service.current, (now) =>
            Stream.concat(Stream.make(now), service.changes),
          ),
        ),
      ),
    ),
    (result) => AsyncResult.getOrThrow(result),
  );
  const page: WebPage = {
    view,
    retained,
    location: Atom.make(STANDALONE_LOCATION),
    chosen,
    read: runtime.atom((get) => {
      const sample = get(chosen);
      return Rendering.use((rendering) => rendering.temporal).pipe(
        Effect.as(sample),
      );
    }),
    connection,
    hydration: Atom.map(connection, (state) => state.hydration),
    opened: Atom.make<ConnectionState["hydration"]>(null),
    workbench: Atom.make((get) => {
      const workbench = openWebWorkbench(bridge, page);
      get.addFinalizer(() => workbench[Symbol.dispose]());
      return workbench;
    }),
    reconnect: runtime.fn(() =>
      WorkbenchConnection.use((service) => service.reconnect),
    ),
    reload: runtime.fn(() =>
      WorkbenchConnection.use((service) => service.reload),
    ),
    disconnect: runtime.fn(() =>
      WorkbenchConnection.use((service) => service.disconnect).pipe(
        Effect.andThen(
          Effect.sync(() => {
            toast.add({
              title: m.workbench_connection_disconnect_complete(),
              type: "info",
            });
          }),
        ),
      ),
    ),
    save: runtime.fn((job: SaveJob) =>
      WorkbenchConnection.use((service) => service.save(job.source)).pipe(
        Effect.flatMap((saved) =>
          saved
            ? Effect.sync(() => {
                job.saved(saved);
                toast.add({
                  title: m.workbench_save_complete({ vault: saved.vault }),
                  type: "success",
                });
              })
            : Effect.void,
        ),
      ),
    ),
    saveAgainst: runtime.fn(
      (expected: SaveSelectedProfileRequest["expected"]) =>
        WorkbenchConnection.use((service) => service.saveAgainst(expected)),
    ),
    importFile: runtime.fn((job: ImportJob) =>
      Transfer.use((transfer) => transfer.readFile(job.file)).pipe(
        Effect.match({ onSuccess: job.read, onFailure: job.failed }),
      ),
    ),
  };
  return page;
}

/** What the editor's views lay over the model's own presentation. */
type Presentation = WorkbenchViewState["presentation"];

/** One editor of the page: the Workbench model over the page's atoms. */
export interface WebWorkbench extends Disposable {
  readonly editor: WorkbenchEditorInstance;
  readonly model: WorkbenchModel;
  /** The chosen paper's Annotations, and the one chosen among them. */
  readonly annotations: Atom.Atom<ReturnType<typeof annotationSamples>>;
  /**
   * The last manifest the document parsed with. The header and the Name and
   * folder form read it, so repairing an invalid draft blanks neither.
   */
  readonly manifest: Atom.Atom<ProfileManifest | null>;
  /** What the last file action said, until the document changes. */
  readonly notice: Atom.Atom<string | null>;
  /** Loads the Item selected in Zotero and chooses it. */
  readonly loadItem: Atom.AtomResultFn<void, void, never>;
  /** Hands `source` to Obsidian through the clipboard. */
  readonly openInObsidian: Atom.AtomResultFn<string, void, never>;
  /** Chooses `sample` on every surface, keeping the Annotation where it can. */
  readonly show: (sample: SampleItem) => void;
  /** Chooses the Annotation `id` of the chosen paper on every surface. */
  readonly chooseAnnotation: (id: string | null) => void;
  /** Opens `source` as the document being edited, with a history of its own. */
  readonly load: (source: string) => void;
  /** Says `text` until the document changes. */
  readonly say: (text: string | null) => void;
  /** Changes what the editor reveals, selects, and opens. */
  readonly present: (changes: Partial<Presentation>) => void;
}

type ProfileManifest = NonNullable<
  WorkbenchDocumentController["document"]
>["manifest"];

function openWebWorkbench(bridge: PageBridge, page: WebPage): WebWorkbench {
  const { registry, runtime } = bridge;
  // The connection as the draft on screen sees it: a hydration the page has
  // not opened yet answers a document the editor does not show.
  const settled = Atom.make((get) => get(page.hydration) === get(page.opened));
  const connected = Atom.map(page.connection, (state) => state.connection);
  const resources = Atom.map(page.connection, (state) => state.resources);
  const itemData = ({ controller, document }: WorkbenchItemDataInput) =>
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
  /** The document, language, and paper behind whatever attempt fails next. */
  const reportContext = (): WorkbenchReportContext => {
    const { tab, advanced } = registry.get(page.view);
    const { connection } = registry.get(page.connection);
    return {
      document: registry.get(page.location).reference,
      language: registry.get(model.controller).language,
      // The result column shows the Annotation tab's example while that tab
      // is open, so a failure there is reported against the annotation root.
      root: !advanced && tab === "annotation" ? "annotation" : "note",
      selection: registry.get(page.chosen).item.indexedKey,
      ...(connection.state === "connected"
        ? { zotlitVersion: connection.pluginVersion }
        : {}),
    };
  };
  const editor = createWorkbenchEditor({
    host: {
      render: (request) =>
        bridge.provide(Rendering.use((rendering) => rendering.render(request))),
      matchData: {
        tags: Effect.suspend(() => paperData().tags),
        collections: Effect.suspend(() => paperData().collections),
        libraries: Effect.suspend(() => paperData().libraries),
        customFields: Effect.suspend(() => paperData().customFields),
        matches: (indexedKey, filter) =>
          Effect.suspend(() => paperData().matches(indexedKey, filter)),
      },
    },
    controller: new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE),
    registry,
    runtime,
    view: page.view,
    itemData,
    reportContext,
  });
  const model = editor.model;
  /** The Match data of the chosen paper, as the Match tab reads it. */
  const paperData = () => matchData(registry.get(page.chosen), bridge);
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
  const shown = Atom.make((get) => {
    get(model.document.revision);
    const controller = get(model.controller);
    const previous = Option.getOrUndefined(
      get.self<{
        readonly controller: WorkbenchDocumentController;
        readonly manifest: ProfileManifest | null;
      }>(),
    );
    return {
      controller,
      manifest:
        controller.document?.manifest ??
        (previous?.controller === controller ? previous.manifest : null),
    };
  });
  const manifest = Atom.map(shown, (state) => state.manifest);
  const said = Atom.make<{ text: string; revision: number } | null>(null);
  const notice = Atom.make((get) => {
    const held = get(said);
    return held && held.revision === get(model.document.revision)
      ? held.text
      : null;
  });
  const say = (text: string | null) =>
    registry.set(
      said,
      text === null
        ? null
        : { text, revision: registry.get(model.document.revision) },
    );
  const choose = (sample: SampleItem, id: string | null) =>
    registry.update(
      model.choices,
      chooseAnnotation(annotationSamples(sample, id).example),
    );
  const show = (sample: SampleItem) => {
    const annotation = registry.get(model.choices).annotation?.id ?? null;
    Atom.batch(() => {
      if (sample.provenance.kind === "connected")
        registry.set(page.retained, sample);
      registry.update(page.view, chooseItem(itemChoice(sample)));
      choose(sample, annotation);
    });
  };
  choose(registry.get(page.chosen), null);
  const releases = [
    registry.mount(dependencies),
    registry.mount(citationStyle),
    registry.mount(annotations),
    registry.mount(notice),
    // The paper this Profile is written for: the bundled Item carrying its
    // sample item type, once per named type. A vault paper stays on screen.
    registry.subscribe(
      Atom.map(manifest, (shownManifest) => shownManifest?.sampleItemType),
      (itemType) => {
        const bundled = SAMPLE_ITEMS.find(
          (sample) => sample.item.itemType === itemType,
        );
        if (
          bundled &&
          registry.get(page.chosen).provenance.kind !== "connected"
        )
          show(bundled);
      },
      { immediate: true },
    ),
  ];
  return {
    editor,
    model,
    annotations,
    manifest,
    notice,
    loadItem: runtime.fn(() =>
      WorkbenchConnection.use((service) => service.loadSelectedItem).pipe(
        Effect.flatMap((sample) =>
          sample ? Effect.sync(() => show(sample)) : Effect.void,
        ),
      ),
    ),
    openInObsidian: runtime.fn((source: string) =>
      Transfer.use((transfer) => transfer.openInObsidian(source)).pipe(
        Effect.match({
          onSuccess: () => say(m.workbench_open_obsidian_copied()),
          onFailure: () => say(m.workbench_open_obsidian_failed()),
        }),
      ),
    ),
    show,
    chooseAnnotation: (id) => choose(registry.get(page.chosen), id),
    load: (source) => editor.attach(new WorkbenchDocumentController(source)),
    say,
    present: (changes) =>
      registry.update(page.view, (state) => {
        const presentation = patch<Presentation>(changes)(state.presentation);
        return presentation === state.presentation
          ? state
          : { ...state, presentation };
      }),
    [Symbol.dispose]() {
      for (const release of releases.reverse()) release();
      editor[Symbol.dispose]();
    },
  };
}
