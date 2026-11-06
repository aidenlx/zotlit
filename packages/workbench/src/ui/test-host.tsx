// A host for the shared suite: every adapter call is recorded, preferences
// live in memory, and the theme names each part's class after the part.

import type { RenderRequest } from "#/render/request";
import type { RenderDiagnostic, TemplateRenderResult } from "#/render/result";
import { render as renderUI } from "@testing-library/react";
import { Effect, Layer, Queue } from "effect";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import type { ReactNode } from "react";

import { createWorkbenchEditor, WorkbenchEditorProvider } from "./editor";
import { PICKER_MOVE_KEYS } from "./field-picker";
import {
  WorkbenchClipboardError,
  WorkbenchHostError,
  WorkbenchHostProvider,
} from "./host";
import type {
  WorkbenchFieldsPopoverProps,
  WorkbenchHost,
  WorkbenchMenuRequest,
  WorkbenchPreferenceScope,
  WorkbenchSuggesterRequest,
} from "./host";
import { WorkbenchMessagesProvider } from "./messages";
import { patch } from "./model";
import type {
  WorkbenchItemData,
  WorkbenchModel,
  WorkbenchViewState,
} from "./model";
import type { ViewSize, WorkbenchPanels } from "./panel-layout";
import { m } from "./test-messages";
import { WorkbenchThemeProvider } from "./theme";
import type { WorkbenchClassMap, WorkbenchTheme } from "./theme";

import { WorkbenchDocumentController } from "#/document/controller";
import { DEFAULT_PROFILE_SOURCE } from "#/render/default-profile";
import { failedRender, renderIdentity } from "#/render/result";

/** A render the tree asked for, which the test answers when it chooses. */
export interface PendingRender {
  readonly request: RenderRequest;
  /** Answers with `result` merged over an empty result for this request. */
  answer(result?: Partial<TemplateRenderResult>): void;
  /** Fails the render with a host failure caused by `error`. */
  reject(error: unknown): void;
  /** Whether the tree interrupted the render before it was answered. */
  readonly interrupted: boolean;
  /** Settles once the tree interrupts the render. */
  readonly interruption: Promise<void>;
}

/** A request the host holds open while `hold` is set. */
export interface HeldRequest {
  readonly kind:
    | "confirm"
    | "suggester"
    | "copy"
    | "tags"
    | "collections"
    | "libraries"
    | "matches"
    | "customFields";
  answer(value: unknown): void;
  fail(error: unknown): void;
  /** Whether the tree interrupted the request before it was answered. */
  readonly interrupted: boolean;
  /** Settles once the tree interrupts the request. */
  readonly interruption: Promise<void>;
}

export interface FakeHost extends WorkbenchHost {
  readonly calls: {
    menus: WorkbenchMenuRequest[];
    suggesters: WorkbenchSuggesterRequest[];
    notices: string[];
    confirms: string[];
    /** Every text handed to the clipboard, in order. */
    copies: string[];
    /** How many times the tree moved focus to the Fields action. */
    actionFocuses: number;
  };
  /** Every render asked for, in order, none of them answered yet. */
  readonly renders: PendingRender[];
  /** Takes each render as it starts: the signal a render was asked for. */
  readonly started: Queue.Queue<PendingRender>;
  /**
   * While set, `confirm`, `suggester`, `copy` and every Match data read wait
   * in `held` until the test answers them; otherwise they answer at once.
   */
  hold: boolean;
  readonly held: HeldRequest[];
  readonly preferences: Map<string, string>;
  /** What the next `confirm` answers. */
  confirmAnswer: boolean;
  /** Whether `copy` fails, which stands for a clipboard the host refused. */
  copyFails: boolean;
}

export function fakeHost(): FakeHost {
  const preferences = new Map<string, string>();
  const key = (scope: WorkbenchPreferenceScope, name: string) =>
    `${scope}:${name}`;
  const renders: PendingRender[] = [];
  const started = Effect.runSync(Queue.unbounded<PendingRender>());
  const held: HeldRequest[] = [];
  /** A request that answers at once, or waits in `held` while `hold` is set. */
  function holdable<A, E>(
    kind: HeldRequest["kind"],
    immediate: () => Effect.Effect<A, E>,
  ): Effect.Effect<A, E> {
    return Effect.suspend(() =>
      host.hold
        ? Effect.callback<A, E>((resume) => {
            let interrupted = false;
            const { promise, resolve } = Promise.withResolvers<void>();
            held.push({
              kind,
              answer: (value) => resume(Effect.succeed(value as A)),
              fail: (error) => resume(Effect.fail(error as E)),
              get interrupted() {
                return interrupted;
              },
              interruption: promise,
            });
            return Effect.sync(() => {
              interrupted = true;
              resolve();
            });
          })
        : immediate(),
    );
  }
  const host: FakeHost = {
    messages: m,
    getLocale: () => "en",
    calls: {
      menus: [],
      suggesters: [],
      notices: [],
      confirms: [],
      copies: [],
      actionFocuses: 0,
    },
    renders,
    started,
    hold: false,
    held,
    preferences,
    confirmAnswer: true,
    copyFails: false,
    menu: (request) => void host.calls.menus.push(request),
    dialog: () => ({ close() {} }),
    confirm: (request) =>
      holdable("confirm", () => {
        host.calls.confirms.push(request.title);
        return Effect.succeed(host.confirmAnswer);
      }),
    suggester: (request) =>
      holdable("suggester", () => {
        host.calls.suggesters.push(request);
        return Effect.succeed(request.selected ?? null);
      }),
    tooltip: (text) => ({ "aria-description": text }),
    notice: (text) => void host.calls.notices.push(text),
    copy: (text) =>
      holdable("copy", () => {
        host.calls.copies.push(text);
        return host.copyFails
          ? Effect.fail(
              new WorkbenchClipboardError({
                cause: new Error("Clipboard denied"),
              }),
            )
          : Effect.void;
      }),
    communityUrl: "https://example.invalid/community",
    docsUrl: "https://example.invalid",
    // Every render is held open, so a test decides when a result lands and
    // what the reader had time to change before it did.
    render: (request) =>
      Effect.callback<TemplateRenderResult, WorkbenchHostError>((resume) => {
        const identity = renderIdentity(request);
        let interrupted = false;
        const { promise, resolve } = Promise.withResolvers<void>();
        const pending: PendingRender = {
          request,
          answer: (result) =>
            resume(
              Effect.succeed({
                ...failedRender(identity, { code: "render-error" }),
                diagnostics: [],
                ...result,
              }),
            ),
          reject: (error) =>
            resume(Effect.fail(new WorkbenchHostError({ cause: error }))),
          get interrupted() {
            return interrupted;
          },
          interruption: promise,
        };
        renders.push(pending);
        Queue.offerUnsafe(started, pending);
        return Effect.sync(() => {
          interrupted = true;
          resolve();
        });
      }),
    markdown: ({ markdown }) => <div role="document">{markdown}</div>,
    matchData: {
      tags: holdable("tags", () => Effect.succeed(["reading", "methods"])),
      collections: holdable("collections", () =>
        Effect.succeed([["Thesis", "Chapter 1"]]),
      ),
      libraries: holdable("libraries", () =>
        Effect.succeed([{ id: "personal", name: "My Library" }] as const),
      ),
      matches: () =>
        holdable("matches", () =>
          Effect.succeed({ kind: "result", matched: false } as const),
        ),
      customFields: holdable("customFields", () =>
        Effect.succeed(["Reading status"]),
      ),
    },
    insertTarget: () => null,
    fieldsAction: {
      popover: FakeFieldsPopover,
      popoverId: "fake-fields-picker",
      focus: () => void host.calls.actionFocuses++,
    },
    persistence: {
      read: (scope, name) => preferences.get(key(scope, name)) ?? null,
      write: (scope, name, value) => {
        if (value === null) preferences.delete(key(scope, name));
        else preferences.set(key(scope, name), value);
      },
    },
  };
  return host;
}

/** The picker's surface, which binds its keys as a host would and closes on Escape. */
function FakeFieldsPopover({
  open,
  onClose,
  keys,
  labelledBy,
  returnFocus,
  children,
}: WorkbenchFieldsPopoverProps) {
  // A closed surface says whether its focus went back to the action.
  if (!open) return <span hidden data-return-focus={String(returnFocus)} />;
  return (
    <div
      id="fake-fields-picker"
      role="dialog"
      aria-labelledby={labelledBy}
      onKeyDown={(event) => {
        const move = PICKER_MOVE_KEYS[event.key];
        if (move) keys.move(move);
        else if (event.key === "Enter") keys.choose();
        else if (event.key === "Escape") onClose();
        else return;
        event.preventDefault();
      }}
    >
      {children}
    </div>
  );
}

/** Every part wears `part-<name>`, so a test can see the map land. */
export const FAKE_CLASSES: WorkbenchClassMap = {
  tabBar: { "tab-bar": "part-tab-bar", tab: "part-tab" },
  tabPanel: { "tab-panel": "part-tab-panel" },
  editToolbar: { mode: "part-mode", undo: "part-undo" },
  problemsFooter: { problems: "part-problems" },
};

export const FAKE_THEME: WorkbenchTheme = {
  classes: FAKE_CLASSES,
  icon: (name) => <i data-icon={name} />,
};

/** Disposing it disposes the editor and registry `mount` built, so bind it with `using`. */
export interface Mounted extends Disposable {
  host: FakeHost;
  /** The registry the editor's model lives in. */
  registry: AtomRegistry.AtomRegistry;
  model: WorkbenchModel;
  controller: WorkbenchDocumentController;
  ui: ReactNode;
  /** Puts other children under the same host and editor, for a rerender. */
  wrap(children: ReactNode): ReactNode;
}

/** The one runtime of the test host, as a host keeps one for all its editors. */
export const TEST_RUNTIME = Atom.runtime(Layer.empty);

/** The tree under a fake host and theme, over the built-in Default. */
export function mount(
  children: ReactNode,
  {
    source = DEFAULT_PROFILE_SOURCE,
    state,
    panels,
    viewSize,
  }: {
    source?: string;
    state?: Partial<WorkbenchViewState>;
    panels?: WorkbenchPanels;
    viewSize?: Atom.Atom<ViewSize | null>;
  } = {},
): Mounted {
  const host = fakeHost();
  const controller = new WorkbenchDocumentController(source);
  const registry = AtomRegistry.make({
    defaultIdleTTL: 0,
    timeoutResolution: 1,
  });
  const editor = createWorkbenchEditor({
    host,
    controller,
    registry,
    runtime: TEST_RUNTIME,
    ...(state ? { state } : {}),
    ...(panels ? { panels } : {}),
    ...(viewSize ? { viewSize } : {}),
  });
  const { model } = editor;
  const wrap = (children: ReactNode) => (
    <WorkbenchThemeProvider theme={FAKE_THEME}>
      <WorkbenchHostProvider host={host}>
        <WorkbenchEditorProvider editor={editor}>
          {children}
        </WorkbenchEditorProvider>
      </WorkbenchHostProvider>
    </WorkbenchThemeProvider>
  );
  return {
    host,
    registry,
    model,
    controller,
    ui: wrap(children),
    wrap,
    [Symbol.dispose]() {
      editor[Symbol.dispose]();
      registry.dispose();
    },
  };
}

/** What a test drives: the registry and the model the editor keeps in it. */
type Driven = Pick<Mounted, "registry" | "model">;

/** Sets the chosen Item's data, which the test host keeps in a writable atom. */
export function setItemData(
  { registry, model }: Driven,
  data: Partial<WorkbenchItemData>,
): void {
  if (!Atom.isWritable(model.itemData))
    throw new Error("The test host keeps the Item data in a writable atom.");
  registry.update(model.itemData, patch(data));
}

/** Presses Run on the model's scheduler. */
export function pressRun({ registry, model }: Driven): void {
  registry.set(model.scheduler.run, undefined);
}

/** Shows `diagnostic` as the host's report of a render it could not run. */
export function reportFailure(
  { registry, model }: Driven,
  diagnostic: RenderDiagnostic,
): void {
  registry.set(model.scheduler.fail, diagnostic);
}

/** The state the preview reads. */
export function schedulerState({ registry, model }: Driven) {
  return registry.get(model.scheduler.state);
}

/** Supply messages for component tests that exercise the optional-host surface. */
export function renderWithMessages(
  ui: ReactNode,
  options?: Parameters<typeof renderUI>[1],
): ReturnType<typeof renderUI> {
  return renderUI(ui, {
    wrapper: ({ children }) => (
      <WorkbenchMessagesProvider messages={m}>
        {children}
      </WorkbenchMessagesProvider>
    ),
    ...options,
  });
}
