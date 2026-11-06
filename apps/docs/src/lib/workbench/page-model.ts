// The web Workbench on the Workbench model: the page's own atoms (the chosen
// Item's one read, the connection's state, the draft's location, the vault
// Item the page keeps), the one editor the page opens, and the commands the
// page runs, all on the page runtime and in the page's registry. Closing the
// page disposes the registry, which interrupts every read and command still
// running.

import { Effect, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";

import type { SaveSelectedProfileRequest } from "@zotlit/workbench/bridge";
import { WorkbenchDocumentController } from "@zotlit/workbench/document";
import type { WorkbenchSliceRange } from "@zotlit/workbench/document";
import {
  DEFAULT_PROFILE_SOURCE,
  SAMPLE_ANNOTATIONS,
  SAMPLE_ITEMS,
} from "@zotlit/workbench/render";
import type { WorkbenchReportContext } from "@zotlit/workbench/render";
import {
  annotationSamples,
  chooseAnnotation,
  createWorkbenchEditor,
  INITIAL_VIEW,
  patchAt,
} from "@zotlit/workbench/ui";
import type {
  WorkbenchEditorInstance,
  WorkbenchHostError,
  WorkbenchItemChoice,
  WorkbenchItemData,
  WorkbenchItemDataInput,
  ViewSize,
  WorkbenchModel,
  WorkbenchViewState,
} from "@zotlit/workbench/ui";

import { toast } from "@/components/ui/toast";
import { m } from "@/paraglide/messages.js";

import {
  DEFAULT_SAMPLE,
  makeDraftKeeper,
  STANDALONE_LOCATION,
} from "./draft-keeper";
import type { DraftKeeper } from "./draft-keeper";
import type { SampleItem } from "./fields";
import { PAGE_PANELS } from "./frame";
import { matchData } from "./host";
import { Rendering } from "./rendering";
import type { PageBridge } from "./runtime";
import type { DraftLocation, WorkbenchDraft } from "./transfer";
import { Transfer } from "./transfer";
import { unsupportedDependencies, unsupportedProblems } from "./unsupported";
import { WorkbenchConnection } from "./workbench-connection";
import type { ConnectionState } from "./workbench-connection";

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

/** A document that would replace the one on screen, held while the reader decides. */
export type Replacement =
  | { readonly kind: "import"; readonly source: string }
  | { readonly kind: "default" }
  | { readonly kind: "reload" }
  | { readonly kind: "reconnect" };

/** The page's own layout around the editor. */
export interface PageLayout {
  /** A replacement waiting on the reader, while the draft has unsaved work. */
  readonly pending: Replacement | null;
  /** Where the caret last stood in the note, which the Note tab returns to. */
  readonly noteCaret: WorkbenchSliceRange;
}

/** The page's atoms and commands; one page has one. */
export interface WebPage {
  readonly view: Atom.Writable<WorkbenchViewState>;
  /** The size of the page's frame, which the page measures to place the side panels. */
  readonly viewSize: Atom.Writable<ViewSize | null>;
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
  /** The revision the text on screen descends from, which Save answers for. */
  readonly saveAgainst: Atom.AtomResultFn<
    SaveSelectedProfileRequest["expected"],
    void,
    never
  >;
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
    viewSize: Atom.make<ViewSize | null>(null),
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
    saveAgainst: runtime.fn(
      (expected: SaveSelectedProfileRequest["expected"]) =>
        WorkbenchConnection.use((service) => service.saveAgainst(expected)),
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
  readonly drafts: DraftKeeper;
  readonly layout: Atom.Writable<PageLayout>;
  /** Saves `source` to the vault and takes it as the saved state. */
  readonly save: Atom.AtomResultFn<string, void, never>;
  /** Reads a Profile file the reader picked and offers it as a replacement. */
  readonly importFile: Atom.AtomResultFn<File, void, never>;
  /** Opens `next` now, or holds it while the draft has unsaved work. */
  readonly replace: (next: Replacement) => void;
  /** Runs the held replacement when `run` is true; otherwise keeps editing. */
  readonly settle: (run: boolean) => void;
  /** Restores the last visit's draft with its paper and Annotation. */
  readonly restoreDraft: () => void;
  /** Changes what the editor reveals, selects, and opens. */
  readonly present: (changes: Partial<Presentation>) => void;
  /** The document, language, and paper behind whatever attempt fails next. */
  readonly reportContext: () => WorkbenchReportContext;
}

function openWebWorkbench(bridge: PageBridge, page: WebPage): WebWorkbench {
  const { registry, runtime } = bridge;
  // The connection as the draft on screen sees it: a hydration the page has
  // not opened yet answers a document the editor does not show.
  const settled = Atom.make((get) => get(page.hydration) === get(page.opened));
  const connected = Atom.map(page.connection, (state) => state.connection);
  const resources = Atom.map(page.connection, (state) => state.resources);
  const itemData = ({ document }: WorkbenchItemDataInput) =>
    Atom.make((get): WorkbenchItemData => {
      const problems = get(document.problems);
      const parsed = get(document.parsed);
      const state = get(page.connection);
      const read = get(page.read);
      const refused =
        unsupportedProblems(problems).length > 0 ||
        unsupportedDependencies(state.resources?.dependencies).length > 0;
      return {
        // The chosen paper is data the page already holds; its read waits
        // only for `Temporal`, which the hold below answers.
        snapshot: get(page.chosen),
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
    panels: PAGE_PANELS,
    viewSize: page.viewSize,
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
  const choose = (id: string | null) =>
    registry.update(model.choices, chooseAnnotation(id));
  // The Annotation choice stays: a paper that lacks it shows its first one.
  const show = (sample: SampleItem) =>
    Atom.batch(() => {
      if (sample.provenance.kind === "connected")
        registry.set(page.retained, sample);
      registry.set(model.pick, itemChoice(sample));
    });
  const present = (changes: Partial<Presentation>) =>
    registry.update(
      page.view,
      patchAt<WorkbenchViewState, "presentation">("presentation", changes),
    );
  const layout = Atom.make<PageLayout>({
    pending: null,
    noteCaret: { from: 0, to: 0 },
  });
  const drafts = makeDraftKeeper({
    registry,
    runtime,
    location: page.location,
    screen: {
      source: model.document.source,
      sample: page.chosen,
      // The page always reads a paper, so an example always stands.
      annotationSelection: Atom.map(
        model.examples,
        ({ example }) => example?.id ?? SAMPLE_ANNOTATIONS[0]!.id,
      ),
      expected: Atom.make((get) => {
        const { saveTarget } = get(page.connection);
        return saveTarget?.reference === get(page.location).reference
          ? saveTarget.expected
          : undefined;
      }),
    },
  });
  /** Opens `source` as the document being edited, with a history of its own. */
  const load = (source: string) =>
    Atom.batch(() => {
      editor.attach(new WorkbenchDocumentController(source));
      say(null);
      registry.update(page.view, (state): WorkbenchViewState => ({
        ...state,
        advanced: false,
        tab: "note",
        presentation: {
          ...state.presentation,
          selected: null,
          reveal: null,
          selection: { slice: "note", range: { from: 0, to: 0 } },
        },
      }));
      registry.update(layout, (state): PageLayout => ({
        ...state,
        noteCaret: { from: 0, to: 0 },
      }));
    });
  const openStandalone = (source: string) =>
    Atom.batch(() => {
      drafts.adopt({ reference: "standalone", source }, null);
      load(source);
    });
  // Set by Reload so the next hydration opens the vault's bytes over the
  // draft on screen.
  let replaceConnected = false;
  const run = (next: Replacement) => {
    switch (next.kind) {
      case "import":
        return openStandalone(next.source);
      case "default":
        return openStandalone(DEFAULT_PROFILE_SOURCE);
      case "reload":
        replaceConnected = true;
        return registry.set(page.reload, undefined);
      case "reconnect":
        return registry.set(page.reconnect, undefined);
    }
  };
  const replace = (next: Replacement) => {
    if (registry.get(drafts.dirty))
      registry.update(layout, (state) => ({ ...state, pending: next }));
    else run(next);
  };
  /** Opens the Profile a connection hydrated, with what it kept beside it. */
  const openHydration = ({
    selected,
    installationId,
    kept,
    retainedExpected,
    snapshot,
  }: NonNullable<ConnectionState["hydration"]>) => {
    const annotation = registry.get(model.choices).annotationId;
    const opened = {
      reference: selected.document.reference,
      source: selected.source,
      installationId,
      ...(snapshot
        ? {
            snapshot,
            annotationSelection: annotationSamples(snapshot, annotation).example
              .id,
          }
        : {}),
    };
    // A connection that comes back to the document already open leaves the
    // text and its undo history where they are: the connection was lost, the
    // work was not. The vault counts as part of that identity, so the same
    // reference read out of another vault is another document and opens as
    // one. The vault's own bytes become the saved state the draft is measured
    // against, so an unsaved edit stays an unsaved edit.
    const where = registry.get(page.location);
    if (
      where.reference === opened.reference &&
      where.installationId === opened.installationId &&
      !replaceConnected
    ) {
      drafts.rebase(opened);
      if (snapshot) show(snapshot);
      // The text on screen still descends from the revision it was read at,
      // so Save answers for that one: the vault moved, this draft did not.
      if (retainedExpected) registry.set(page.saveAgainst, retainedExpected);
      return;
    }
    drafts.adopt(opened, replaceConnected ? null : kept);
    replaceConnected = false;
    load(selected.source);
    if (snapshot) show(snapshot);
  };
  /** Opens the last visit's draft with its paper and Annotation. */
  const restore = (draft: WorkbenchDraft) => {
    load(draft.source);
    // A tab that closed on a vault paper comes back to the text alone, so the
    // paper on screen stands.
    if (draft.snapshot) show(draft.snapshot);
    if (draft.annotationSelection) choose(draft.annotationSelection);
    if (draft.expected) registry.set(page.saveAgainst, draft.expected);
  };
  const releases = [
    registry.mount(dependencies),
    registry.mount(citationStyle),
    registry.mount(model.examples),
    registry.mount(notice),
    registry.mount(layout),
    registry.mount(page.reconnect),
    registry.mount(page.reload),
    registry.mount(page.saveAgainst),
    drafts.hold(),
    // The paper this Profile is written for: the bundled Item carrying its
    // sample item type, once per named type. A vault paper stays on screen.
    registry.subscribe(
      Atom.map(
        model.document.manifest,
        (shownManifest) => shownManifest?.sampleItemType,
      ),
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
    // Each hydration opens once. Until it has, the reads that follow the
    // draft on screen wait.
    registry.subscribe(
      page.hydration,
      (hydration) => {
        if (hydration === registry.get(page.opened)) return;
        // One batch, so the prompt measures the page once it is open.
        if (hydration) Atom.batch(() => openHydration(hydration));
        registry.set(page.opened, hydration);
      },
      { immediate: true },
    ),
  ];
  return {
    editor,
    model,
    notice,
    drafts,
    layout,
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
    save: runtime.fn((source: string) =>
      WorkbenchConnection.use((service) => service.save(source)).pipe(
        Effect.flatMap((saved) =>
          saved
            ? Effect.sync(() => {
                drafts.rebase({
                  reference: saved.reference,
                  source: saved.source,
                });
                toast.add({
                  title: m.workbench_save_complete({ vault: saved.vault }),
                  type: "success",
                });
              })
            : Effect.void,
        ),
      ),
    ),
    importFile: runtime.fn((file: File) =>
      Transfer.use((transfer) => transfer.readFile(file)).pipe(
        Effect.match({
          onSuccess: (source) => replace({ kind: "import", source }),
          onFailure: () => say(m.workbench_import_failed()),
        }),
      ),
    ),
    replace,
    settle: (confirmed) => {
      const { pending } = registry.get(layout);
      registry.update(layout, (state) => ({ ...state, pending: null }));
      if (confirmed && pending) run(pending);
    },
    restoreDraft: () => {
      const draft = drafts.restore();
      if (draft) Atom.batch(() => restore(draft));
    },
    show,
    chooseAnnotation: choose,
    load,
    say,
    present,
    reportContext,
    [Symbol.dispose]() {
      for (const release of releases.reverse()) release();
      editor[Symbol.dispose]();
    },
  };
}
