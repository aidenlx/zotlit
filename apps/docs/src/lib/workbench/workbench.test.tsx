// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BRIDGE_CAPABILITIES,
  BRIDGE_VERSION,
  LOCAL_BRIDGE_PATHS,
} from "@zotlit/workbench/bridge";
import type { SaveSelectedProfileResponse } from "@zotlit/workbench/bridge";
import { DEFAULT_PROFILE_SOURCE, SAMPLE_ITEMS } from "@zotlit/workbench/render";
import type { RenderRequest } from "@zotlit/workbench/render";

import { m } from "@/paraglide/messages.js";

import { Workbench } from "./workbench";

// A render needs a Worker, which this environment has none of; the page under
// test is asked only whether it starts one.
const { startRenderWorker } = vi.hoisted(() => ({
  startRenderWorker: vi.fn((_request: RenderRequest) => ({
    terminate: () => {},
  })),
}));
vi.mock("./render-client", () => ({ startRenderWorker }));

const KEY = "zotlit.workbench.draft.standalone";
/** Quiet time after the last change, plus room for the write to land. */
const SETTLE_MS = 700;
/** The width this environment opens on, which every test starts from. */
const DEFAULT_WIDTH = window.innerWidth;
const KEPT = DEFAULT_PROFILE_SOURCE.replace("name: Default", "name: Kept work");
const ETA = DEFAULT_PROFILE_SOURCE.replace("language: liquid", "language: eta");
const CONNECTED = DEFAULT_PROFILE_SOURCE.replace(
  "name: Default",
  "name: Connected profile",
);
/** A standalone CSL style, which is what a bundled installed style must be. */
const FIXTURE_CSL_STYLE =
  '<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0">' +
  "<citation><layout/></citation></style>";

// This environment carries no Storage of its own, so each test starts on one
// that behaves as a browser's does.
beforeEach(() => {
  installStorage("localStorage");
  installStorage("sessionStorage");
  window.history.replaceState(null, "", "/workbench");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("No Local Bridge is running."))),
  );
  startRenderWorker.mockClear();
});

// The viewport is one window the whole file shares, so a test that draws the
// page at another width hands the next one back the width it opened on.
afterEach(() => {
  resize(DEFAULT_WIDTH);
  vi.unstubAllGlobals();
});

describe("a Workbench Connection", () => {
  it("connects from a fragment, loads the selected Item, and saves a new revision", async () => {
    const requests: BridgeRequest[] = [];
    vi.stubGlobal("fetch", bridgeFetch(requests));
    window.location.hash = "#zotlit-connect=fixture-code";
    using page = open();

    await page.waitFor(() =>
      expect(title(page.host)).toBe("Connected profile"),
    );
    expect(title(page.host)).toBe("Connected profile");
    expect(
      requests.every(
        ({ receiver }) => receiverName(receiver) !== "LocalBridgeClient",
      ),
    ).toBe(true);
    expect(page.host.textContent).toContain("Fixture vault");
    expect(page.host.textContent).toContain(m.workbench_save());

    page.press(m.workbench_load_item());
    await page.waitFor(() =>
      expect(page.host.textContent).toContain(m.workbench_connected_badge()),
    );
    expect(page.host.textContent).toContain(m.workbench_connected_badge());
    await page.settle();
    expect(startRenderWorker.mock.calls.at(-1)?.[0].resources).toEqual({
      dependencies: {
        templates: [
          {
            name: "fixture-heading",
            language: "liquid",
            source: "# Fixture: {{ zt.title }}",
          },
        ],
        diagnostics: [],
      },
      citationStyle: {
        kind: "installed",
        styleId: "ieee",
        xml: FIXTURE_CSL_STYLE,
      },
    });

    page.press(m.workbench_save());
    await page.waitFor(() =>
      expect(page.host.textContent).toContain(
        m.workbench_save_complete({ revision: "revision-2" }),
      ),
    );
    expect(page.host.textContent).toContain(
      m.workbench_save_complete({ revision: "revision-2" }),
    );
    expect(requests.find(({ path }) => path.endsWith("/save"))?.body).toEqual({
      reference: "profile:default",
      expected: { state: "revision", revision: "revision-1" },
      source: CONNECTED,
    });
  });

  it("keeps the loaded draft when Save reports a revision conflict", async () => {
    const requests: BridgeRequest[] = [];
    vi.stubGlobal(
      "fetch",
      bridgeFetch(requests, {
        save: {
          state: "refused",
          reason: "revision-conflict",
          currentRevision: "external-revision",
        },
      }),
    );
    using page = open();

    page.press(m.workbench_connection_connect());
    await page.waitFor(() =>
      expect(title(page.host)).toBe("Connected profile"),
    );
    await page.settle();

    page.press(m.workbench_add_field());
    const sheet = openSheet(page.host);
    selectField(sheet, m.workbench_field_title());
    const snippet = sheet.querySelector("code")!.textContent!;
    press(sheet, m.workbench_fields_put_in_note());
    page.press(m.workbench_save());
    await page.waitFor(() =>
      expect(page.host.textContent).toContain(m.workbench_save_conflict()),
    );

    expect(title(page.host)).toBe("Connected profile");
    expect(page.host.textContent).toContain(m.workbench_save_conflict());
    const saves = () =>
      requests.filter(
        ({ path }) => path === LOCAL_BRIDGE_PATHS.saveSelectedProfile,
      );
    expect(saves()[0]?.body).toMatchObject({
      source: expect.stringContaining(snippet),
    });

    openMenu(page.host);
    page.press(m.workbench_undo());
    page.press(m.workbench_save());
    await page.waitFor(() => expect(saves()).toHaveLength(2));
    expect(saves()[1]?.body).toMatchObject({ source: CONNECTED });
  });

  it("keeps the draft through a disconnect and reconnect", async () => {
    const requests: BridgeRequest[] = [];
    const externalSource = `${CONNECTED}\nExternal Fixture edit`;
    vi.stubGlobal(
      "fetch",
      bridgeFetch(requests, {
        conflictOnce: {
          revision: "external-revision",
          source: externalSource,
        },
      }),
    );
    using page = open();

    page.press(m.workbench_connection_connect());
    await page.waitFor(() =>
      expect(title(page.host)).toBe("Connected profile"),
    );
    page.press(m.workbench_add_field());
    const sheet = openSheet(page.host);
    selectField(sheet, m.workbench_field_title());
    const snippet = sheet.querySelector("code")!.textContent!;
    press(sheet, m.workbench_fields_put_in_note());
    await page.settle();

    page.press(m.workbench_save());
    await page.waitFor(() =>
      expect(page.host.textContent).toContain(m.workbench_save_conflict()),
    );

    page.press(m.workbench_connection_disconnect());
    await page.waitFor(() =>
      expect(page.host.textContent).toContain(
        m.workbench_connection_disconnected_notice(),
      ),
    );
    await page.settle();
    expect(
      JSON.parse(
        localStorage.getItem("zotlit.workbench.draft.profile:default")!,
      ).expected,
    ).toEqual({ state: "revision", revision: "revision-1" });
    localStorage.removeItem("zotlit.workbench.draft.profile:default");
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("Site data is blocked.");
    });
    page.press(m.workbench_connection_connect());
    await page.waitFor(() =>
      expect(page.host.textContent).toContain(
        m.workbench_connection_disconnect(),
      ),
    );

    // The work never left the page, so nothing is offered back, and it still
    // answers for the revision it was read at: the vault moved under this
    // draft, which is no permission to write over the edit that moved it.
    expect(page.host.textContent).not.toContain(m.workbench_restore_heading());
    openMenu(page.host);
    page.press(m.workbench_advanced());
    expect(sourceView(page.host).state.doc.toString()).toContain(snippet);

    page.press(m.workbench_save());
    const saves = () =>
      requests.filter(
        ({ path }) => path === LOCAL_BRIDGE_PATHS.saveSelectedProfile,
      );
    await page.waitFor(() => expect(saves()).toHaveLength(2));
    expect(saves()[1]?.body).toMatchObject({
      reference: "profile:default",
      expected: { state: "revision", revision: "revision-1" },
      source: expect.stringContaining(snippet),
    });
  });

  it("restores a kept conflict draft against the revision it was read at", async () => {
    const requests: BridgeRequest[] = [];
    const externalSource = `${CONNECTED}\nExternal Fixture edit`;
    vi.stubGlobal(
      "fetch",
      bridgeFetch(requests, {
        conflictOnce: {
          revision: "external-revision",
          source: externalSource,
        },
      }),
    );
    let snippet = "";
    {
      using page = open();
      page.press(m.workbench_connection_connect());
      await page.waitFor(() =>
        expect(title(page.host)).toBe("Connected profile"),
      );
      page.press(m.workbench_add_field());
      const sheet = openSheet(page.host);
      selectField(sheet, m.workbench_field_title());
      snippet = sheet.querySelector("code")!.textContent!;
      press(sheet, m.workbench_fields_put_in_note());
      await page.settle();

      page.press(m.workbench_save());
      await page.waitFor(() =>
        expect(page.host.textContent).toContain(m.workbench_save_conflict()),
      );
    }

    // A reload opens the vault's refreshed source and offers the kept work.
    using reloaded = open();
    await reloaded.waitFor(() =>
      expect(reloaded.host.textContent).toContain(
        m.workbench_restore_heading(),
      ),
    );

    reloaded.press(m.workbench_restore_accept());
    reloaded.press(m.workbench_save());
    const saves = () =>
      requests.filter(
        ({ path }) => path === LOCAL_BRIDGE_PATHS.saveSelectedProfile,
      );
    await reloaded.waitFor(() => expect(saves()).toHaveLength(2));
    expect(saves()[1]?.body).toMatchObject({
      reference: "profile:default",
      expected: { state: "revision", revision: "revision-1" },
      source: expect.stringContaining(snippet),
    });
  });

  it("cancels a page-initiated connection while approval is pending", async () => {
    const requests: BridgeRequest[] = [];
    vi.stubGlobal("fetch", bridgeFetch(requests, { loopbackPending: true }));
    using page = open();

    page.press(m.workbench_connection_connect());
    await page.waitFor(() =>
      expect(page.host.textContent).toContain(m.workbench_connection_cancel()),
    );
    page.press(m.workbench_connection_cancel());
    await page.waitFor(() =>
      expect(page.host.textContent).toContain(m.workbench_connection_connect()),
    );

    expect(
      requests.filter(
        ({ path }) => path === LOCAL_BRIDGE_PATHS.loopbackBootstrap,
      ),
    ).toHaveLength(1);
    expect(page.host.textContent).not.toContain("No Local Bridge is running");
  });

  it("stops polling for approval when the reader leaves the page", async () => {
    const requests: BridgeRequest[] = [];
    vi.stubGlobal("fetch", bridgeFetch(requests, { loopbackPending: true }));
    {
      using page = open();
      page.press(m.workbench_connection_connect());
      await page.waitFor(() =>
        expect(page.host.textContent).toContain(
          m.workbench_connection_cancel(),
        ),
      );
    }

    const probe = requests.find(
      ({ path }) => path === LOCAL_BRIDGE_PATHS.loopbackBootstrap,
    );
    expect(probe?.signal?.aborted).toBe(true);
  });

  it("refetches the citation style when its manifest binding changes", async () => {
    const requests: BridgeRequest[] = [];
    vi.stubGlobal("fetch", bridgeFetch(requests));
    using page = open();

    page.press(m.workbench_connection_connect());
    await page.waitFor(() =>
      expect(title(page.host)).toBe("Connected profile"),
    );
    openMenu(page.host);
    page.press(m.workbench_advanced());
    const view = [...page.host.querySelectorAll<HTMLElement>(".cm-editor")]
      .map((editor) => EditorView.findFromDOM(editor)!)
      .find((editor) => editor.state.doc.toString().startsWith("---"))!;
    const source = view.state.doc.toString();
    const changed = source
      .replace("id: default", "id: fixture")
      .replace(
        "language: liquid\n",
        "language: liquid\ncitationStyle: fixture-style\n",
      );
    act(() => {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: changed,
        },
        userEvent: "input.type",
      });
    });

    await page.waitFor(() =>
      expect(startRenderWorker.mock.calls.at(-1)?.[0].resources).toMatchObject({
        citationStyle: {
          kind: "installed",
          styleId: "fixture-style",
        },
      }),
    );
    expect(
      requests.filter(
        ({ path }) => path === LOCAL_BRIDGE_PATHS.selectedCitationStyle,
      ),
    ).toHaveLength(2);
  });

  it("keeps connected state after one bridge operation fails", async () => {
    const requests: BridgeRequest[] = [];
    vi.stubGlobal(
      "fetch",
      bridgeFetch(requests, { itemProtocolFailureOnce: true }),
    );
    using page = open();

    page.press(m.workbench_connection_connect());
    await page.waitFor(() =>
      expect(title(page.host)).toBe("Connected profile"),
    );
    page.press(m.workbench_load_item());
    await page.waitFor(() =>
      expect(page.host.textContent).toContain(
        m.workbench_connection_failed({ message: "Fixture item failure." }),
      ),
    );

    expect(page.host.textContent).toContain(
      m.workbench_connection_disconnect(),
    );
    page.press(m.workbench_save());
    await page.waitFor(() =>
      expect(page.host.textContent).toContain(
        m.workbench_save_complete({ revision: "revision-2" }),
      ),
    );
  });

  it("offers Reconnect after the Local Bridge disappears", async () => {
    const requests: BridgeRequest[] = [];
    vi.stubGlobal(
      "fetch",
      bridgeFetch(requests, { itemNetworkFailureOnce: true }),
    );
    using page = open();

    page.press(m.workbench_connection_connect());
    await page.waitFor(() =>
      expect(title(page.host)).toBe("Connected profile"),
    );
    page.press(m.workbench_load_item());
    await page.waitFor(() =>
      expect(page.host.textContent).toContain(
        m.workbench_connection_disconnected_notice(),
      ),
    );

    expect(page.host.textContent).toContain(m.workbench_connection_reconnect());
    expect(page.host.textContent).toContain(m.workbench_download());
    page.press(m.workbench_connection_reconnect());
    await page.waitFor(() =>
      expect(page.host.textContent).toContain(
        m.workbench_connection_disconnect(),
      ),
    );
  });

  it("reconnects on the kept credential without a fresh approval", async () => {
    const requests: BridgeRequest[] = [];
    vi.stubGlobal(
      "fetch",
      bridgeFetch(requests, { itemNetworkFailureOnce: true }),
    );
    using page = open();

    page.press(m.workbench_connection_connect());
    await page.waitFor(() =>
      expect(title(page.host)).toBe("Connected profile"),
    );
    page.press(m.workbench_load_item());
    await page.waitFor(() =>
      expect(page.host.textContent).toContain(
        m.workbench_connection_reconnect(),
      ),
    );

    page.press(m.workbench_connection_reconnect());
    await page.waitFor(() =>
      expect(page.host.textContent).toContain(
        m.workbench_connection_disconnect(),
      ),
    );

    // The blip left the grant intact, so Reconnect re-checked it instead of
    // asking Obsidian to approve the page a second time.
    expect(
      requests.filter(
        ({ path }) => path === LOCAL_BRIDGE_PATHS.loopbackBootstrap,
      ),
    ).toHaveLength(1);
  });

  it("keeps the session credential through a lost connection", async () => {
    vi.stubGlobal("fetch", bridgeFetch([], { itemNetworkFailureOnce: true }));
    {
      using page = open();
      page.press(m.workbench_connection_connect());
      await page.waitFor(() =>
        expect(title(page.host)).toBe("Connected profile"),
      );
      page.press(m.workbench_load_item());
      await page.waitFor(() =>
        expect(page.host.textContent).toContain(
          m.workbench_connection_reconnect(),
        ),
      );
    }

    // A reload re-checks compatibility and revision with the kept credential,
    // rather than asking Obsidian for a fresh approval.
    using restored = open();
    await restored.waitFor(() =>
      expect(restored.host.textContent).toContain("Fixture vault"),
    );
  });

  it("creates the built-in Default against an expected absence", async () => {
    const requests: BridgeRequest[] = [];
    vi.stubGlobal("fetch", bridgeFetch(requests, { builtInAbsent: true }));
    using page = open();

    page.press(m.workbench_connection_connect());
    await page.waitFor(() =>
      expect(title(page.host)).toBe("Connected profile"),
    );
    page.press(m.workbench_save());
    await page.waitFor(() =>
      expect(page.host.textContent).toContain(
        m.workbench_save_complete({ revision: "revision-2" }),
      ),
    );

    expect(requests.find(({ path }) => path.endsWith("/save"))?.body).toEqual({
      reference: "profile:default",
      expected: { state: "absent" },
      source: CONNECTED,
    });
    expect(page.host.textContent).toContain(
      m.workbench_save_complete({ revision: "revision-2" }),
    );
  });

  it("marks a loaded Item Snapshot as retained after disconnect", async () => {
    vi.stubGlobal("fetch", bridgeFetch([]));
    using page = open();

    page.press(m.workbench_connection_connect());
    await page.waitFor(() =>
      expect(title(page.host)).toBe("Connected profile"),
    );
    page.press(m.workbench_load_item());
    await page.waitFor(() =>
      expect(page.host.textContent).toContain(m.workbench_connected_badge()),
    );
    page.press(m.workbench_connection_disconnect());
    await page.waitFor(() =>
      expect(page.host.textContent).toContain(m.workbench_retained_badge()),
    );

    expect(page.host.textContent).toContain(m.workbench_retained_badge());
    expect(page.host.textContent).toContain(m.workbench_download());
    expect(startRenderWorker.mock.calls.at(-1)?.[0].resources).toBeUndefined();

    page.show(SAMPLE_ITEMS[1]!.item.key);
    expect(page.host.textContent).toContain(m.workbench_sample_badge());
    expect(shownItem(page.host)).toBe(SAMPLE_ITEMS[1]!.item.key);
  });

  it("keeps standalone work separate from a disconnected profile draft", async () => {
    vi.stubGlobal("fetch", bridgeFetch([]));
    keep(KEPT, SAMPLE_ITEMS[1]!);
    using page = open();

    page.press(m.workbench_restore_accept());
    await page.settle();
    page.press(m.workbench_connection_connect());
    await page.waitFor(() =>
      expect(title(page.host)).toBe("Connected profile"),
    );
    page.press(m.workbench_add_field());
    const sheet = openSheet(page.host);
    selectField(sheet, m.workbench_field_title());
    const snippet = sheet.querySelector("code")!.textContent!;
    press(sheet, m.workbench_fields_put_in_note());
    await page.settle();

    page.press(m.workbench_connection_disconnect());
    await page.waitFor(() =>
      expect(page.host.textContent).toContain(
        m.workbench_connection_disconnected_notice(),
      ),
    );
    await page.settle();

    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({
      source: KEPT,
    });
    expect(
      JSON.parse(
        localStorage.getItem("zotlit.workbench.draft.profile:default")!,
      ),
    ).toMatchObject({ source: expect.stringContaining(snippet) });
  });

  it("refuses a profile whose vault partial the web workbench cannot run", async () => {
    vi.stubGlobal("fetch", bridgeFetch([], { etaDependency: true }));
    using page = open();

    page.press(m.workbench_connection_connect());
    await page.waitFor(() =>
      expect(page.host.textContent).toContain(
        m.workbench_unsupported_heading(),
      ),
    );

    // The bundle is read before anything compiles, so the Profile is handed on
    // rather than edited, rendered, or saved.
    expect(page.host.textContent).toContain(
      m.workbench_problem_unsupported_partial({ name: "fixture-heading" }),
    );
    expect(page.host.querySelector('[role="tablist"]')).toBeNull();
    expect(page.host.textContent).not.toContain(m.workbench_save());
    await page.settle();
    expect(rendered()).not.toContain(CONNECTED);
  });

  it("reads the bundle again when the draft calls another partial", async () => {
    const requests: BridgeRequest[] = [];
    vi.stubGlobal("fetch", bridgeFetch(requests));
    using page = open();

    page.press(m.workbench_connection_connect());
    await page.waitFor(() =>
      expect(title(page.host)).toBe("Connected profile"),
    );
    const bundles = () =>
      requests.filter(
        ({ path }) => path === LOCAL_BRIDGE_PATHS.templateDependencies,
      );
    expect(bundles()).toHaveLength(1);

    openMenu(page.host);
    page.press(m.workbench_advanced());
    const view = sourceView(page.host);
    act(() => {
      view.dispatch({
        changes: {
          from: view.state.doc.length,
          insert: "\n{% render 'summary' %}",
        },
        userEvent: "input.type",
      });
    });

    // The draft now calls a partial the vault holds, so the bundle is read for
    // the draft rather than for the file the vault saved.
    await page.waitFor(() => expect(bundles()).toHaveLength(2));
    expect(bundles()[1]?.body).toMatchObject({
      source: expect.stringContaining("{% render 'summary' %}"),
    });
  });

  it("shows the vault's own binding defaults on an unset binding", async () => {
    vi.stubGlobal("fetch", bridgeFetch([]));
    using page = open();

    page.press(m.workbench_connection_connect());
    await page.waitFor(() =>
      expect(title(page.host)).toBe("Connected profile"),
    );
    page.press(m.workbench_tab_name_and_folder());

    // The built-in Default's bindings live in Obsidian, so the tab reads the
    // vault's effective values rather than the plugin's built-in ones.
    expect(page.host.textContent).toContain("fixture-literature");
    expect(page.host.textContent).not.toContain("literatures");
  });

  it("restores the connection from tab storage on reload", async () => {
    const requests: BridgeRequest[] = [];
    vi.stubGlobal("fetch", bridgeFetch(requests));
    {
      using page = open();
      page.press(m.workbench_connection_connect());
      await page.waitFor(() =>
        expect(title(page.host)).toBe("Connected profile"),
      );
    }

    using restored = open();
    await restored.waitFor(() =>
      expect(restored.host.textContent).toContain("Fixture vault"),
    );

    expect(restored.host.textContent).toContain("Fixture vault");
    expect(restored.host.textContent).toContain(m.workbench_save());
    expect(
      requests.filter(
        ({ path }) => path === LOCAL_BRIDGE_PATHS.loopbackBootstrap,
      ),
    ).toHaveLength(1);
    // The grant records the versions it was issued under, so the reload asks
    // the bridge running now rather than trusting the tab's own copy.
    expect(
      requests.filter(({ path }) => path === LOCAL_BRIDGE_PATHS.resumeSession),
    ).toHaveLength(1);
  });

  it("refuses a profile whose partial the vault would not hand over", async () => {
    const refusal =
      "Template dependency 'summary' uses an unsupported language.";
    vi.stubGlobal("fetch", bridgeFetch([], { dependencyRefusal: refusal }));
    using page = open();

    page.press(m.workbench_connection_connect());
    await page.waitFor(() =>
      expect(page.host.textContent).toContain(
        m.workbench_unsupported_heading(),
      ),
    );

    // The bridge names the partial it refused; nothing else in this page can.
    expect(page.host.textContent).toContain(refusal);
    expect(page.host.querySelector('[role="tablist"]')).toBeNull();
  });
});

describe("the kept draft on the next visit", () => {
  it("holds the last visit's work back until the prompt is accepted", () => {
    keep(KEPT, SAMPLE_ITEMS[1]!);
    using page = open();

    // The prompt stands over the document a fresh visit opens on.
    expect(page.host.textContent).toContain(m.workbench_restore_heading());
    expect(title(page.host)).toBe("Default");
    expect(shownItem(page.host)).toBe(SAMPLE_ITEMS[0]!.item.key);

    page.press(m.workbench_restore_accept());

    // Both halves come back together: the draft, and the paper it was shown
    // against.
    expect(title(page.host)).toBe("Kept work");
    expect(shownItem(page.host)).toBe(SAMPLE_ITEMS[1]!.item.key);
    expect(page.host.textContent).not.toContain(m.workbench_restore_heading());
  });

  it("drops the record when the reader starts clean", () => {
    keep(KEPT, SAMPLE_ITEMS[1]!);
    using page = open();

    page.press(m.workbench_restore_decline());

    expect(page.host.textContent).not.toContain(m.workbench_restore_heading());
    expect(title(page.host)).toBe("Default");
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("keeps what the reader changes before answering the prompt", async () => {
    keep(KEPT, SAMPLE_ITEMS[1]!);
    using page = open();

    page.show(SAMPLE_ITEMS[2]!.item.key);

    // The change answers the prompt the way Start clean does, so the next
    // visit is offered the paper this one chose rather than the older draft.
    expect(page.host.textContent).not.toContain(m.workbench_restore_heading());
    await page.settle();
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
      source: DEFAULT_PROFILE_SOURCE,
      snapshot: SAMPLE_ITEMS[2],
    });
  });

  it("offers nothing an untouched visit left, and clears what it found", async () => {
    localStorage.setItem(KEY, "kept before the snapshot contract moved on");
    using page = open();

    expect(page.host.textContent).not.toContain(m.workbench_restore_heading());
    await page.settle();

    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe("a profile the web workbench refuses", () => {
  it("shows the handoff, and hands the refused source to no render", async () => {
    keep(ETA, SAMPLE_ITEMS[0]!);
    using page = open();

    page.press(m.workbench_restore_accept());

    expect(page.host.textContent).toContain(m.workbench_unsupported_heading());
    expect(page.host.textContent).toContain(m.workbench_unsupported_download());
    // None of the editing panes are reachable from this screen.
    expect(page.host.querySelector('[role="tablist"]')).toBeNull();
    await page.settle();
    expect(rendered()).not.toContain(ETA);
  });
});

describe("a draft the parser refuses", () => {
  it("keeps the last good result, and opens the pane the problem names", async () => {
    using page = open();
    await page.settle();
    const rendersOfGoodSource = rendered().length;
    expect(rendersOfGoodSource).toBeGreaterThan(0);

    openMenu(page.host);
    page.press(m.workbench_advanced());
    const view = sourceView(page.host);
    const broken = view.state.doc
      .toString()
      .replace("# {{ zt.title }}", "{% managed %}\nTwice\n{% endmanaged %}");
    act(() => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: broken },
        userEvent: "input.type",
      });
    });
    await page.settle();

    // Nothing renders a draft the parser refuses, so the sheet keeps the last
    // good result while the Problems strip carries the repair.
    expect(rendered()).toHaveLength(rendersOfGoodSource);
    expect(page.host.textContent).toContain(m.workbench_problems_heading());

    page.press(m.workbench_problems_where_note());

    expect(chosenTab(page.host)).toBe(m.workbench_tab_note());
  });

  it("opens Name and folder for a field that tab writes", async () => {
    using page = open();
    openMenu(page.host);
    page.press(m.workbench_advanced());
    const view = sourceView(page.host);
    act(() => {
      view.dispatch({
        changes: emptied(view.state.doc.toString(), "name: Default"),
        userEvent: "input.type",
      });
    });
    await page.settle();

    expect(page.host.textContent).toContain(m.workbench_problems_heading());
    page.press(m.workbench_problems_where_details());

    expect(chosenTab(page.host)).toBe(m.workbench_tab_name_and_folder());
    // The form writes its fields through controls, so the reader lands in the
    // one holding the field the parser named.
    expect(document.activeElement?.id).toBe("workbench-field-name");
  });
});

describe("the paper a profile is written for", () => {
  it("opens on the bundled sample item its sample item type names", async () => {
    const book = SAMPLE_ITEMS.find(({ item }) => item.itemType === "book")!;
    using page = open();

    importFile(page.host, withSampleItemType("book"));

    await page.waitFor(() => expect(shownItem(page.host)).toBe(book.item.key));
  });

  it("names a type no bundled sample carries, and keeps the paper on screen", async () => {
    using page = open();

    importFile(page.host, withSampleItemType("webpage"));

    await page.waitFor(() =>
      expect(page.host.textContent).toContain(
        m.workbench_sample_type_missing({ itemType: "webpage" }),
      ),
    );
    expect(shownItem(page.host)).toBe(SAMPLE_ITEMS[0]!.item.key);
  });
});

describe("the field list", () => {
  it("searches the complete Zotero tree without opening the foot first", async () => {
    using page = open();
    const search = page.host.querySelector<HTMLInputElement>(
      `input[aria-label="${m.workbench_fields_search()}"]`,
    )!;

    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(search, "DOI");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await page.waitFor(() =>
      expect(
        [...page.host.querySelectorAll("button")].some(
          (button) => button.firstElementChild?.textContent === "DOI",
        ),
      ).toBe(true),
    );
    expect(page.host.textContent).not.toContain(
      m.workbench_fields_no_matches(),
    );
  });
});

/** The default Profile, written for one Zotero item type. */
function withSampleItemType(itemType: string): string {
  return DEFAULT_PROFILE_SOURCE.replace(
    "language: liquid",
    `language: liquid\nsampleItemType: ${itemType}`,
  );
}

describe("the result column", () => {
  it("offers the update-only managed region beside the note", () => {
    using page = open();

    expect(page.host.textContent).toContain(m.workbench_result_heading());
    page.press(m.workbench_result_managed_toggle());

    // The part an update rewrites is its own result, so it is read on its own
    // rather than found inside the note a creation gets.
    expect(page.host.textContent).toContain(
      m.workbench_result_managed_heading(),
    );
    expect(page.host.textContent).not.toContain(m.workbench_result_heading());
  });
});

/** Clears the value on `line`, which leaves the manifest field it holds empty. */
function emptied(
  source: string,
  line: string,
): { from: number; to: number; insert: string } {
  const from = source.indexOf(line);
  return { from, to: from + line.length, insert: `${line.split(":")[0]}:` };
}

describe("the document's way in and out", () => {
  it("opens an imported profile and hands its bytes back", async () => {
    using page = open();
    const blobs: Blob[] = [];
    const names: string[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return "blob:workbench";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function (this: HTMLAnchorElement) {
        names.push(this.download);
      },
    );

    importFile(page.host, KEPT);
    await page.waitFor(() => expect(title(page.host)).toBe("Kept work"));

    openMenu(page.host);
    page.press(m.workbench_download());

    expect(names).toEqual(["zotlit-profile.default.md"]);
    await expect(blobs[0]!.text()).resolves.toBe(KEPT);
  });
});

describe("the narrow layout", () => {
  it("carries the result on a tab of its own", () => {
    using page = open();

    // The pane opens the page; the result is the one tap beside it.
    expect(chosenView(page.host)).toBe(m.workbench_view_editor());
    page.press(m.workbench_view_result());
    expect(chosenView(page.host)).toBe(m.workbench_view_result());
    // The tabs the wide layout offers stay where they were.
    expect(page.host.textContent).toContain(m.workbench_tab_properties());
  });

  it("inserts from the field sheet where the column would, then closes", async () => {
    using page = open();
    // The list waits for the same Temporal the render does.
    await page.settle();

    page.press(m.workbench_add_field());
    const sheet = openSheet(page.host);
    expect(sheet.getAttribute("aria-label")).toBe(m.workbench_fields_heading());

    selectField(sheet, m.workbench_field_title());
    const snippet = sheet.querySelector("code")!.textContent!;
    press(sheet, m.workbench_fields_put_in_note());

    // The sheet leaves with the snippet it put in the note.
    expect(page.host.querySelector('[role="dialog"]')).toBeNull();
    await page.settle();
    expect(JSON.parse(localStorage.getItem(KEY)!).source).toContain(snippet);
  });

  it("carries the reader back to the pane when Advanced opens", () => {
    using page = open();

    page.press(m.workbench_view_result());
    openMenu(page.host);
    page.press(m.workbench_advanced());

    // Advanced stands inside the pane, so a press made from the result tab
    // shows what it opened.
    expect(chosenView(page.host)).toBe(m.workbench_view_editor());
    expect(page.host.textContent).toContain(m.workbench_advanced_heading());
  });

  it("leaves the reader on the result when Advanced closes", () => {
    using page = open();

    openMenu(page.host);
    page.press(m.workbench_advanced());
    page.press(m.workbench_view_result());
    openMenu(page.host);
    page.press(m.workbench_advanced());

    // Closing Advanced opens nothing over the pane, so the result the reader
    // is reading stays the tab they are on.
    expect(chosenView(page.host)).toBe(m.workbench_view_result());
  });

  it("returns the keyboard to the button the field sheet was opened from", () => {
    using page = open();

    page.press(m.workbench_add_field());
    press(openSheet(page.host), m.workbench_fields_close());

    const button = [...page.host.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === m.workbench_add_field(),
    );
    expect(document.activeElement).toBe(button);
  });

  it("leaves the field sheet on Escape", () => {
    using page = open();

    page.press(m.workbench_add_field());
    expect(openSheet(page.host)).not.toBeNull();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(page.host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("returns a widened window to the pane", () => {
    resize(375);
    using page = open();

    page.press(m.workbench_view_result());
    expect(chosenView(page.host)).toBe(m.workbench_view_result());

    // Past the threshold the two tabs are gone, so the result reads as chosen
    // on a screen carrying no tab that says so.
    resize(900);

    expect(chosenView(page.host)).toBe(m.workbench_view_editor());
  });
});

interface OpenPage extends Disposable {
  host: HTMLElement;
  /** Presses the button carrying `label`. */
  press: (label: string) => void;
  /** Picks the Sample Item the page is shown against. */
  show: (key: string) => void;
  /** Waits out the autosave's quiet time and the render's own. */
  settle: () => Promise<void>;
  /** Waits until immediate Local Bridge responses produce `assertion`. */
  waitFor: (assertion: () => void) => Promise<void>;
}

/** The page mounted for real, so its own effects run. */
function open(): OpenPage {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<Workbench />));
  return {
    host,
    press: (label) => press(host, label),
    show(key) {
      const select = host.querySelector("select")!;
      select.value = key;
      act(() => {
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    },
    async settle() {
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
function press(scope: HTMLElement, label: string): void {
  const target = [...scope.querySelectorAll("button")].find(
    (button) => button.textContent === label,
  );
  if (!target) throw new Error(`No button reads '${label}'.`);
  act(() => target.click());
}

/** Selects the field row named `label`, which reveals what the row offers. */
function selectField(scope: HTMLElement, label: string): void {
  const target = [...scope.querySelectorAll("button")].find(
    (button) => button.firstElementChild?.textContent === label,
  );
  if (!target) throw new Error(`No field row reads '${label}'.`);
  act(() => target.click());
}

/** The whole-document editor Advanced opens over. */
function sourceView(host: HTMLElement): EditorView {
  const view = [...host.querySelectorAll<HTMLElement>(".cm-editor")]
    .map((editor) => EditorView.findFromDOM(editor)!)
    .find((editor) => editor.state.doc.toString().startsWith("---"));
  if (!view) throw new Error("Advanced is not open.");
  return view;
}

/** The pane tab the page reads as chosen. */
function chosenTab(host: HTMLElement): string {
  const tabs = host.querySelector(
    `[role="tablist"][aria-label="${m.workbench_title()}"]`,
  )!;
  return tabs.querySelector('[aria-selected="true"]')!.textContent!;
}

/** Hands `source` to the page as the file a reader picked. */
function importFile(host: HTMLElement, source: string): void {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File([source], "profile.md", { type: "text/markdown" })],
  });
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/** Opens the header's More actions menu, where Advanced is offered. */
function openMenu(host: HTMLElement): void {
  const button = host.querySelector<HTMLElement>(
    `button[aria-label="${m.workbench_more_actions()}"]`,
  )!;
  act(() => button.click());
}

/** Draws the page at `width`, the way a window resized to it does. */
function resize(width: number): void {
  const { happyDOM } = window as unknown as {
    happyDOM: { setViewport: (size: { width: number }) => void };
  };
  act(() => happyDOM.setViewport({ width }));
}

/** The field list the narrow layout's "Add a field" opened. */
function openSheet(host: HTMLElement): HTMLElement {
  const sheet = host.querySelector<HTMLElement>('[role="dialog"]');
  if (!sheet) throw new Error("No field sheet is open.");
  return sheet;
}

/** The tab the narrow layout reads as chosen: the pane, or the result. */
function chosenView(host: HTMLElement): string {
  const tabs = host.querySelector(
    `[role="tablist"][aria-label="${m.workbench_view_label()}"]`,
  )!;
  return tabs.querySelector('[aria-selected="true"]')!.textContent!;
}

/** Every source a render was started over. */
function rendered(): string[] {
  return startRenderWorker.mock.calls.map(([request]) => request.source);
}

/** Puts a record where the page reads the last visit's own. */
function keep(source: string, snapshot: (typeof SAMPLE_ITEMS)[number]): void {
  localStorage.setItem(KEY, JSON.stringify({ source, snapshot }));
}

/** The profile name the header carries. */
function title(host: HTMLElement): string {
  return host.querySelector("h1")?.textContent ?? "";
}

/** The Sample Item the page says it is showing. */
function shownItem(host: HTMLElement): string {
  return host.querySelector("select")!.value;
}

interface BridgeRequest {
  readonly path: string;
  readonly body: unknown;
  readonly receiver: unknown;
  readonly signal?: AbortSignal | null;
}

interface BridgeFixtureOptions {
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

function receiverName(receiver: unknown): string | undefined {
  if (receiver === null || typeof receiver !== "object") return undefined;
  return receiver.constructor.name;
}

function bridgeFetch(
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
        key: SAMPLE_ITEMS[0]!.item.key,
        title: SAMPLE_ITEMS[0]!.item.title,
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

function bridgeResponse({
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
        ...SAMPLE_ITEMS[0],
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

function isStyleRequest(
  value: unknown,
): value is { readonly styleId: unknown } {
  return typeof value === "object" && value !== null && "styleId" in value;
}

function installStorage(name: "localStorage" | "sessionStorage"): void {
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
