// A host for the shared suite: every adapter call is recorded, preferences
// live in memory, and the theme names each part's class after the part.

import type { RenderRequest } from "#/render/request";
import type { TemplateRenderResult } from "#/render/result";
import { render as renderUI } from "@testing-library/react";
import { Effect } from "effect";
import type { ReactNode } from "react";

import { createWorkbenchEditor, WorkbenchEditorProvider } from "./editor";
import {
  WorkbenchClipboardError,
  WorkbenchHostError,
  WorkbenchHostProvider,
} from "./host";
import type {
  WorkbenchHost,
  WorkbenchMenuRequest,
  WorkbenchPreferenceScope,
  WorkbenchSuggesterRequest,
} from "./host";
import { WorkbenchMessagesProvider } from "./messages";
import { makeWorkbenchRunner } from "./run";
import type { RenderScheduler } from "./scheduler";
import type { WorkbenchStore, WorkbenchViewState } from "./store";
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
}

export interface FakeHost extends WorkbenchHost {
  readonly calls: {
    menus: WorkbenchMenuRequest[];
    suggesters: WorkbenchSuggesterRequest[];
    notices: string[];
    confirms: string[];
    /** Every text handed to the clipboard, in order. */
    copies: string[];
  };
  /** Every render asked for, in order, none of them answered yet. */
  readonly renders: PendingRender[];
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
  /** Closes the runner, as a host does when its mount goes. */
  close(): void;
}

export function fakeHost(): FakeHost {
  const preferences = new Map<string, string>();
  const key = (scope: WorkbenchPreferenceScope, name: string) =>
    `${scope}:${name}`;
  const renders: PendingRender[] = [];
  const held: HeldRequest[] = [];
  const runner = makeWorkbenchRunner();
  /** A request that answers at once, or waits in `held` while `hold` is set. */
  function holdable<A, E>(
    kind: HeldRequest["kind"],
    immediate: () => Effect.Effect<A, E>,
  ): Effect.Effect<A, E> {
    return Effect.suspend(() =>
      host.hold
        ? Effect.callback<A, E>((resume) => {
            let interrupted = false;
            held.push({
              kind,
              answer: (value) => resume(Effect.succeed(value as A)),
              fail: (error) => resume(Effect.fail(error as E)),
              get interrupted() {
                return interrupted;
              },
            });
            return Effect.sync(() => {
              interrupted = true;
            });
          })
        : immediate(),
    );
  }
  const host: FakeHost = {
    messages: m,
    run: runner.run,
    close: runner.close,
    getLocale: () => "en",
    calls: { menus: [], suggesters: [], notices: [], confirms: [], copies: [] },
    renders,
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
    // Every render is held open, so a test decides when a result lands and
    // what the reader had time to change before it did.
    render: (request) =>
      Effect.callback<TemplateRenderResult, WorkbenchHostError>((resume) => {
        const identity = renderIdentity(request);
        let interrupted = false;
        renders.push({
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
        });
        return Effect.sync(() => {
          interrupted = true;
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

/** Disposing it disposes the scheduler `mount` built, so bind it with `using`. */
export interface Mounted extends Disposable {
  host: FakeHost;
  store: WorkbenchStore;
  controller: WorkbenchDocumentController;
  scheduler: RenderScheduler;
  ui: ReactNode;
}

/** The tree under a fake host and theme, over the built-in Default. */
export function mount(
  children: ReactNode,
  {
    source = DEFAULT_PROFILE_SOURCE,
    state,
  }: { source?: string; state?: Partial<WorkbenchViewState> } = {},
): Mounted {
  const host = fakeHost();
  const controller = new WorkbenchDocumentController(source);
  const editor = createWorkbenchEditor({
    host,
    controller,
    state,
  });
  const { store, scheduler } = editor;
  return {
    host,
    store,
    controller,
    scheduler,
    ui: (
      <WorkbenchThemeProvider theme={FAKE_THEME}>
        <WorkbenchHostProvider host={host}>
          <WorkbenchEditorProvider
            store={store}
            controller={controller}
            scheduler={scheduler}
          >
            {children}
          </WorkbenchEditorProvider>
        </WorkbenchHostProvider>
      </WorkbenchThemeProvider>
    ),
    [Symbol.dispose]() {
      editor[Symbol.dispose]();
      host.close();
    },
  };
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
