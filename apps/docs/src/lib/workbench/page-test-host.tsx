// Browser storage, Worker transport, and Local Bridge fixtures for web host tests.
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, vi } from "vitest";

import {
  BRIDGE_CAPABILITIES,
  BRIDGE_VERSION,
  LOCAL_BRIDGE_PATHS,
} from "@zotlit/workbench/bridge";
import type { SaveSelectedProfileResponse } from "@zotlit/workbench/bridge";
import {
  DEFAULT_PROFILE_SOURCE,
  SAMPLE_ITEMS,
  renderProfile,
} from "@zotlit/workbench/render";
import type {
  ProfileRenderResult,
  RenderRequest,
} from "@zotlit/workbench/render";
import { m } from "@zotlit/workbench/ui";

import { Workbench } from "./workbench";

// The browser Worker boundary delivers real renderer output in this DOM host.
const { startRenderWorker } = vi.hoisted(() => ({
  startRenderWorker: vi.fn(
    (
      _request: RenderRequest,
      _deliver: (result: ProfileRenderResult) => void,
    ) => ({
      terminate: () => {},
    }),
  ),
}));

vi.mock("./render-client", () => ({ startRenderWorker }));
export { startRenderWorker };

export const KEY = "zotlit.workbench.draft.standalone";

/** Quiet time after the last change, plus room for the write to land. */
export const SETTLE_MS = 700;

/** The width this environment opens on, which every test starts from. */
export const DEFAULT_WIDTH = window.innerWidth;

export const KEPT = DEFAULT_PROFILE_SOURCE.replace(
  "name: Default",
  "name: Kept work",
);

export const ETA = DEFAULT_PROFILE_SOURCE.replace(
  "language: liquid",
  "language: eta",
);

export const CONNECTED = DEFAULT_PROFILE_SOURCE.replace(
  "name: Default",
  "name: Connected profile",
);

/** A standalone CSL style, which is what a bundled installed style must be. */
export const FIXTURE_CSL_STYLE =
  '<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0">' +
  "<citation><layout/></citation></style>";

// This environment carries no Storage of its own, so each test starts on one
// that behaves as a browser's does.
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  installStorage("localStorage");
  installStorage("sessionStorage");
  window.history.replaceState(null, "", "/workbench");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("No Local Bridge is running."))),
  );
  startRenderWorker.mockClear();
  startRenderWorker.mockImplementation((request, deliver) => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled)
        deliver(renderProfile(request.source, request.snapshot, request));
    });
    return {
      terminate: () => {
        cancelled = true;
      },
    };
  });
});

// The viewport is one window the whole file shares, so a test that draws the
// page at another width hands the next one back the width it opened on.
afterEach(() => {
  resize(DEFAULT_WIDTH);
  vi.unstubAllGlobals();
});

/** The default Profile, written for one Zotero item type. */
export function withSampleItemType(itemType: string): string {
  return DEFAULT_PROFILE_SOURCE.replace(
    "language: liquid",
    `language: liquid\nsampleItemType: ${itemType}`,
  );
}

/** Clears the value on `line`, which leaves the manifest field it holds empty. */
export function emptied(
  source: string,
  line: string,
): { from: number; to: number; insert: string } {
  const from = source.indexOf(line);
  return { from, to: from + line.length, insert: `${line.split(":")[0]}:` };
}

export interface OpenPage extends Disposable {
  host: HTMLElement;
  /** Presses the button carrying `label`. */
  press: (label: string) => void;
  /** Picks the Sample Item the page is shown against. */
  show: (key: string) => Promise<void>;
  /** Waits out the autosave's quiet time and the render's own. */
  settle: () => Promise<void>;
  /** Waits until immediate Local Bridge responses produce `assertion`. */
  waitFor: (assertion: () => void) => Promise<void>;
}

/** The page mounted for real, so its own effects run. */
export function open(): OpenPage {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<Workbench />));
  return {
    host,
    press: (label) => press(host, label),
    async show(key) {
      act(() => host.querySelector<HTMLElement>("#workbench-sample")!.click());
      const label = SAMPLE_ITEMS.find((item) => item.item.key === key)!.item
        .title;
      const option = [
        ...document.querySelectorAll<HTMLElement>('[role="option"]'),
      ].find((item) => item.textContent.startsWith(label!))!;
      await act(async () => {
        option.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            pointerType: "mouse",
          }),
        );
        option.click();
      });
    },
    async settle() {
      await act(async () => {});
      await act(() => new Promise((resolve) => setTimeout(resolve, SETTLE_MS)));
    },
    async waitFor(assertion) {
      await vi.waitFor(async () => {
        await act(async () => {});
        assertion();
      });
    },
    [Symbol.dispose]() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

/** Presses the button reading exactly `label` inside `scope`. */
export function press(scope: HTMLElement, label: string): void {
  const target = [
    ...scope.querySelectorAll<HTMLElement>("button, [role=menuitem]"),
  ].find(
    (button) =>
      button.textContent === label ||
      button.getAttribute("aria-label") === label,
  );
  if (!target) throw new Error(`No button reads '${label}'.`);
  act(() => target.click());
}

/** Finds the field row named `label`, including its insertion controls. */
export function fieldRow(scope: HTMLElement, label: string): HTMLLIElement {
  const target = [...scope.querySelectorAll("span[title]")]
    .find((span) => span.getAttribute("title") === label)
    ?.closest("li");
  if (!target) throw new Error(`No field row reads '${label}'.`);
  return target;
}

export async function chooseAnnotation(
  page: OpenPage,
  text: string,
): Promise<void> {
  page.press(m.workbench_choose_annotation());
  const option = [
    ...document.querySelectorAll<HTMLElement>(
      '[role="dialog"] [role="option"]',
    ),
  ].find((row) => row.textContent.includes(text));
  if (!option) throw new Error(`No annotation reads '${text}'.`);
  await act(async () => option.click());
}

export function resultText(host: HTMLElement): string {
  return (
    host.querySelector(
      `[role="region"][aria-label="${m.workbench_view_result()}"]`,
    )?.textContent ?? ""
  );
}

/** The whole-document editor Advanced opens over. */
export function sourceView(host: HTMLElement): EditorView {
  const view = [...host.querySelectorAll<HTMLElement>(".cm-editor")]
    .map((editor) => EditorView.findFromDOM(editor)!)
    .find((editor) => editor.state.doc.toString().startsWith("---"));
  if (!view) throw new Error("Advanced is not open.");
  return view;
}

/** The pane tab the page reads as chosen. */
export function chosenTab(host: HTMLElement): string {
  const tabs = host.querySelector(
    `[role="tablist"][aria-label="${m.workbench_title()}"]`,
  )!;
  return tabs.querySelector('[aria-selected="true"]')!.textContent!;
}

/** Hands `source` to the page as the file a reader picked. */
export function importFile(host: HTMLElement, source: string): void {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File([source], "profile.md", { type: "text/markdown" })],
  });
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/** Opens the profile file actions through the shadcn menu. */
export function openMenu(host: HTMLElement): void {
  press(host, m.workbench_profile_menu());
}

/** Draws the page at `width`, the way a window resized to it does. */
export function resize(width: number): void {
  const { happyDOM } = window as unknown as {
    happyDOM: { setViewport: (size: { width: number }) => void };
  };
  act(() => happyDOM.setViewport({ width }));
}

/** The field list the narrow layout's "Add a field" opened. */
export function openSheet(host: HTMLElement): HTMLElement {
  const sheet =
    host.ownerDocument.querySelector<HTMLElement>('[role="dialog"]');
  if (!sheet) throw new Error("No field sheet is open.");
  return sheet;
}

/** The tab the narrow layout reads as chosen: the pane, or the result. */
export function chosenView(host: HTMLElement): string {
  const tabs = host.querySelector(
    `[role="group"][aria-label="${m.workbench_view_label()}"]`,
  )!;
  return tabs.querySelector('[aria-pressed="true"]')!.textContent!;
}

/** Every source a render was started over. */
export function rendered(): string[] {
  return startRenderWorker.mock.calls.map(([request]) => request.source);
}

/** Puts a record where the page reads the last visit's own. */
export function keep(
  source: string,
  snapshot: (typeof SAMPLE_ITEMS)[number],
): void {
  localStorage.setItem(KEY, JSON.stringify({ source, snapshot }));
}

/** The profile name the header carries. */
export function title(host: HTMLElement): string {
  return host.querySelector("h1")?.textContent ?? "";
}

/** The Sample Item the page says it is showing. */
export function shownItem(host: HTMLElement): string {
  return (
    host
      .querySelector("#workbench-sample")
      ?.parentElement?.querySelector("span[title]")
      ?.getAttribute("title") ?? ""
  );
}

export interface BridgeRequest {
  readonly path: string;
  readonly body: unknown;
  readonly receiver: unknown;
  readonly signal?: AbortSignal | null;
}

export interface BridgeFixtureOptions {
  readonly item?: () => (typeof SAMPLE_ITEMS)[number];
  readonly builtInAbsent?: boolean;
  readonly conflictOnce?: {
    readonly revision: string;
    readonly source: string;
  };
  readonly itemNetworkFailureOnce?: boolean;
  readonly etaDependency?: boolean;
  /** The sentence a bridge sends instead of handing a partial over. */
  readonly dependencyRefusal?: string;
  readonly itemProtocolFailureOnce?: boolean;
  readonly loopbackPending?: boolean;
  readonly save?: SaveSelectedProfileResponse;
}

export function receiverName(receiver: unknown): string | undefined {
  if (receiver === null || typeof receiver !== "object") return undefined;
  return receiver.constructor.name;
}

export function bridgeFetch(
  requests: BridgeRequest[],
  options: BridgeFixtureOptions = {},
): typeof fetch {
  let selectedSource = CONNECTED;
  let selectedRevision = "revision-1";
  let conflictPending = options.conflictOnce !== undefined;
  let itemNetworkFailurePending = options.itemNetworkFailureOnce === true;
  let itemProtocolFailurePending = options.itemProtocolFailureOnce === true;
  return async function (
    this: typeof globalThis,
    input: string | URL | Request,
    init?: RequestInit,
  ) {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    const body =
      typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    requests.push({
      path: url.pathname,
      body,
      receiver: this,
      signal: init?.signal,
    });

    if (
      url.pathname === LOCAL_BRIDGE_PATHS.loopbackBootstrap &&
      options.loopbackPending
    ) {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) throw new Error("The loopback probe has no abort signal.");
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    }

    if (
      url.pathname === LOCAL_BRIDGE_PATHS.selectedItem &&
      itemNetworkFailurePending
    ) {
      itemNetworkFailurePending = false;
      throw new TypeError("The Local Bridge disappeared.");
    }
    if (
      url.pathname === LOCAL_BRIDGE_PATHS.selectedItem &&
      itemProtocolFailurePending
    ) {
      itemProtocolFailurePending = false;
      return new Response(
        JSON.stringify({
          error: {
            code: "fixture-item-failure",
            message: "Fixture item failure.",
          },
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    const item = options.item?.() ?? SAMPLE_ITEMS[0]!;
    const grant = {
      credential: "fixture-credential",
      installation: {
        id: "fixture-installation",
        vault: "Fixture vault",
        zoteroSourceId: "fixture-source",
      },
      pluginVersion: "2.1.1",
      bridgeVersion: BRIDGE_VERSION,
      templateDataContractVersion: SAMPLE_ITEMS[0]!.contractVersion,
      capabilities: [...BRIDGE_CAPABILITIES],
      selectedItem: {
        key: item.item.key,
        title: item.item.title,
      },
      selectedProfile: { id: "default", name: "Connected profile" },
      profileDefaults: {
        folder: "fixture-literature",
        citationStyle: "ieee",
        importFolder: "fixture-notes",
        importColoredHighlights: true,
        importAnnotationsAsTemplate: false,
      },
    };
    let payload: unknown;
    if (url.pathname === LOCAL_BRIDGE_PATHS.selectedProfile) {
      payload = {
        profile: { id: "default", name: "Connected profile" },
        source: selectedSource,
        document: options.builtInAbsent
          ? { state: "built-in-absent", reference: "profile:default" }
          : {
              state: "present",
              reference: "profile:default",
              revision: selectedRevision,
            },
      };
    } else if (
      url.pathname === LOCAL_BRIDGE_PATHS.saveSelectedProfile &&
      conflictPending
    ) {
      conflictPending = false;
      selectedSource = options.conflictOnce!.source;
      selectedRevision = options.conflictOnce!.revision;
      payload = {
        state: "refused",
        reason: "revision-conflict",
        currentRevision: selectedRevision,
      };
    } else {
      payload = bridgeResponse({ path: url.pathname, grant, options, body });
    }
    return new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json" },
    });
  } as typeof fetch;
}

export function bridgeResponse({
  path,
  grant,
  options,
  body,
}: {
  readonly path: string;
  readonly grant: object;
  readonly options: BridgeFixtureOptions;
  readonly body: unknown;
}): unknown {
  switch (path) {
    case LOCAL_BRIDGE_PATHS.codeBootstrap:
      return grant;
    case LOCAL_BRIDGE_PATHS.loopbackBootstrap:
      return { state: "approved", connection: grant };
    case LOCAL_BRIDGE_PATHS.resumeSession:
      return grant;
    case LOCAL_BRIDGE_PATHS.templateDependencies:
      if (options.dependencyRefusal !== undefined) {
        return {
          templates: [],
          diagnostics: [
            {
              code: "unsupported-dependency",
              message: options.dependencyRefusal,
            },
          ],
        };
      }
      return {
        templates: [
          {
            name: "fixture-heading",
            language: options.etaDependency ? "eta" : "liquid",
            source: "# Fixture: {{ zt.title }}",
          },
        ],
        diagnostics: [],
      };
    case LOCAL_BRIDGE_PATHS.selectedCitationStyle:
      return isStyleRequest(body) && typeof body.styleId === "string"
        ? {
            kind: "installed",
            styleId: body.styleId,
            xml: FIXTURE_CSL_STYLE,
          }
        : { kind: "default" };
    case LOCAL_BRIDGE_PATHS.citationStyles:
      return [
        { id: "apa", title: "American Psychological Association" },
        { id: "ieee", title: "IEEE" },
      ];
    case LOCAL_BRIDGE_PATHS.selectedItem:
      return {
        ...(options.item?.() ?? SAMPLE_ITEMS[0]),
        provenance: {
          kind: "connected",
          installationId: "fixture-installation",
          vault: "Fixture vault",
        },
      };
    case LOCAL_BRIDGE_PATHS.saveSelectedProfile:
      return options.save ?? { state: "saved", revision: "revision-2" };
    case LOCAL_BRIDGE_PATHS.disconnect:
      return {};
    default:
      throw new Error(`Unexpected Local Bridge request to ${path}.`);
  }
}

export function isStyleRequest(
  value: unknown,
): value is { readonly styleId: unknown } {
  return typeof value === "object" && value !== null && "styleId" in value;
}

export function installStorage(name: "localStorage" | "sessionStorage"): void {
  const entries = new Map<string, string>();
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => void entries.set(key, value),
      removeItem: (key: string) => void entries.delete(key),
    },
  });
}
