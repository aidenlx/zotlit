// A host for the shared suite: every adapter call is recorded, preferences
// live in memory, and the theme names each part's class after the part.

import type { ReactNode } from "react";

import { WorkbenchEditorProvider } from "./editor";
import { WorkbenchHostProvider } from "./host";
import type {
  WorkbenchHost,
  WorkbenchMenuRequest,
  WorkbenchPreferenceScope,
  WorkbenchSuggesterRequest,
} from "./host";
import { createWorkbenchStore } from "./store";
import type { WorkbenchStore, WorkbenchViewState } from "./store";
import { WorkbenchThemeProvider } from "./theme";
import type { WorkbenchClassMap, WorkbenchTheme } from "./theme";

import { WorkbenchDocumentController } from "#/document/controller";
import { DEFAULT_PROFILE_SOURCE } from "#/render/default-profile";
import { failedRender, renderIdentity } from "#/render/result";

export interface FakeHost extends WorkbenchHost {
  readonly calls: {
    menus: WorkbenchMenuRequest[];
    suggesters: WorkbenchSuggesterRequest[];
    notices: string[];
    confirms: string[];
  };
  readonly preferences: Map<string, string>;
  /** What the next `confirm` resolves. */
  confirmAnswer: boolean;
}

export function fakeHost(): FakeHost {
  const preferences = new Map<string, string>();
  const key = (scope: WorkbenchPreferenceScope, name: string) =>
    `${scope}:${name}`;
  const host: FakeHost = {
    calls: { menus: [], suggesters: [], notices: [], confirms: [] },
    preferences,
    confirmAnswer: true,
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
    hoverCard: () => ({ close() {} }),
    notice: (text) => void host.calls.notices.push(text),
    render: (request, deliver) => {
      deliver(failedRender(renderIdentity(request), { code: "render-error" }));
      return { terminate() {} };
    },
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

export interface Mounted {
  host: FakeHost;
  store: WorkbenchStore;
  controller: WorkbenchDocumentController;
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
  const store = createWorkbenchStore(state);
  const controller = new WorkbenchDocumentController(source);
  return {
    host,
    store,
    controller,
    ui: (
      <WorkbenchThemeProvider theme={FAKE_THEME}>
        <WorkbenchHostProvider host={host}>
          <WorkbenchEditorProvider store={store} controller={controller}>
            {children}
          </WorkbenchEditorProvider>
        </WorkbenchHostProvider>
      </WorkbenchThemeProvider>
    ),
  };
}
