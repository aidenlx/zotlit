// A host for the shared suite: every adapter call is recorded, preferences
// live in memory, and the theme names each part's class after the part.

import type { RenderRequest } from "#/render/request";
import type { TemplateRenderResult } from "#/render/result";
import { render as renderUI } from "@testing-library/react";
import type { ReactNode } from "react";

import { createWorkbenchEditor, WorkbenchEditorProvider } from "./editor";
import { WorkbenchHostProvider } from "./host";
import type {
  WorkbenchHost,
  WorkbenchMenuRequest,
  WorkbenchPreferenceScope,
  WorkbenchSuggesterRequest,
} from "./host";
import { WorkbenchMessagesProvider } from "./messages";
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
  reject(error: unknown): void;
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
  readonly preferences: Map<string, string>;
  /** What the next `confirm` resolves. */
  confirmAnswer: boolean;
  /** Whether `copy` rejects, which stands for a clipboard the host refused. */
  copyFails: boolean;
}

export function fakeHost(): FakeHost {
  const preferences = new Map<string, string>();
  const key = (scope: WorkbenchPreferenceScope, name: string) =>
    `${scope}:${name}`;
  const renders: PendingRender[] = [];
  const host: FakeHost = {
    messages: m,
    getLocale: () => "en",
    calls: { menus: [], suggesters: [], notices: [], confirms: [], copies: [] },
    renders,
    preferences,
    confirmAnswer: true,
    copyFails: false,
    menu: (request) => void host.calls.menus.push(request),
    dialog: () => ({ close() {} }),
    confirm: (request) => {
      host.calls.confirms.push(request.title);
      return Promise.resolve(host.confirmAnswer);
    },
    suggester: (request) => {
      host.calls.suggesters.push(request);
      return Promise.resolve(request.selected ?? null);
    },
    tooltip: (text) => ({ "aria-description": text }),
    notice: (text) => void host.calls.notices.push(text),
    copy: (text) => {
      host.calls.copies.push(text);
      return host.copyFails
        ? Promise.reject(new Error("Clipboard denied"))
        : Promise.resolve();
    },
    communityUrl: "https://example.invalid/community",
    // Every render is held open, so a test decides when a result lands and
    // what the reader had time to change before it did.
    render: (request) =>
      new Promise<TemplateRenderResult>((resolve, reject) => {
        const identity = renderIdentity(request);
        renders.push({
          request,
          answer: (result) =>
            resolve({
              ...failedRender(identity, { code: "render-error" }),
              diagnostics: [],
              ...result,
            }),
          reject,
        });
      }),
    markdown: ({ markdown }) => <div role="document">{markdown}</div>,
    matchData: {
      tags: () => Promise.resolve(["reading", "methods"]),
      collections: () => Promise.resolve([["Thesis", "Chapter 1"]]),
      libraries: () =>
        Promise.resolve([{ id: "personal", name: "My Library" }]),
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
    },
  };
}

/** Supply messages for component tests that exercise the optional-host surface. */
export function renderWithMessages(
  ui: ReactNode,
  options?: Parameters<typeof renderUI>[1],
) {
  return renderUI(ui, {
    wrapper: ({ children }) => (
      <WorkbenchMessagesProvider messages={m}>
        {children}
      </WorkbenchMessagesProvider>
    ),
    ...options,
  });
}
