// @vitest-environment happy-dom
// Local Bridge transport, resource hydration, credentials, and web Save semantics.
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { LOCAL_BRIDGE_PATHS } from "@zotlit/workbench/bridge";
import { SAMPLE_ITEMS } from "@zotlit/workbench/render";
import { m } from "@zotlit/workbench/ui";

import {
  startRenderWorker,
  KEY,
  KEPT,
  CONNECTED,
  FIXTURE_CSL_STYLE,
  open,
  press,
  fieldRow,
  sourceView,
  openSheet,
  rendered,
  keep,
  title,
  shownItem,
  receiverName,
  bridgeFetch,
} from "./page-test-host";
import type { BridgeRequest } from "./page-test-host";

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

    page.press(m.workbench_choose_paper());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      m.workbench_sample_not_loaded(),
    );
    act(() => {
      document
        .querySelector('[role="dialog"] [role="combobox"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
    });

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
    const snippet = "{{ zt.title }}";
    press(
      fieldRow(sheet, m.workbench_field_title()),
      m.workbench_fields_put_in_note(),
    );
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
    const snippet = "{{ zt.title }}";
    press(
      fieldRow(sheet, m.workbench_field_title()),
      m.workbench_fields_put_in_note(),
    );
    await page.settle();

    page.press(m.workbench_save());
    await page.waitFor(() =>
      expect(page.host.textContent).toContain(m.workbench_save_conflict()),
    );

    page.press(m.workbench_connection_to_vault({ vault: "Fixture vault" }));
    press(document.body, m.workbench_connection_disconnect());
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
        m.workbench_connection_to_vault({ vault: "Fixture vault" }),
      ),
    );

    // The work never left the page, so nothing is offered back, and it still
    // answers for the revision it was read at: the vault moved under this
    // draft, which is no permission to write over the edit that moved it.
    expect(page.host.textContent).not.toContain(m.workbench_restore_heading());
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
      snippet = "{{ zt.title }}";
      press(
        fieldRow(sheet, m.workbench_field_title()),
        m.workbench_fields_put_in_note(),
      );
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
      m.workbench_connection_to_vault({ vault: "Fixture vault" }),
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
        m.workbench_connection_to_vault({ vault: "Fixture vault" }),
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
        m.workbench_connection_to_vault({ vault: "Fixture vault" }),
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
    page.press(m.workbench_connection_to_vault({ vault: "Fixture vault" }));
    press(document.body, m.workbench_connection_disconnect());
    await page.waitFor(() =>
      expect(page.host.textContent).toContain(m.workbench_retained_badge()),
    );

    expect(page.host.textContent).toContain(m.workbench_retained_badge());
    expect(page.host.textContent).toContain(m.workbench_download());
    expect(startRenderWorker.mock.calls.at(-1)?.[0].resources).toBeUndefined();

    await page.show(SAMPLE_ITEMS[1]!.item.key);
    expect(page.host.textContent).toContain(m.workbench_sample_badge());
    expect(shownItem(page.host)).toBe(SAMPLE_ITEMS[1]!.item.title);
    act(() =>
      page.host.querySelector<HTMLElement>("#workbench-sample")!.click(),
    );
    const retained = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((option) =>
      option.textContent.includes(m.workbench_retained_badge()),
    )!;
    await act(async () => {
      retained.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerType: "mouse",
        }),
      );
      retained.click();
    });
    expect(shownItem(page.host)).toBe(SAMPLE_ITEMS[0]!.item.title);
    expect(page.host.textContent).toContain(m.workbench_retained_badge());
  });

  it("keeps standalone work separate from a disconnected profile draft", async () => {
    vi.stubGlobal("fetch", bridgeFetch([]));
    keep(KEPT, SAMPLE_ITEMS[1]!);
    using page = open();

    page.press(m.workbench_restore_accept());
    await page.settle();
    page.press(m.workbench_connection_connect());
    press(openSheet(page.host), m.workbench_connection_connect());
    await page.waitFor(() =>
      expect(title(page.host)).toBe("Connected profile"),
    );
    page.press(m.workbench_add_field());
    const sheet = openSheet(page.host);
    const snippet = "{{ zt.title }}";
    press(
      fieldRow(sheet, m.workbench_field_title()),
      m.workbench_fields_put_in_note(),
    );
    await page.settle();

    page.press(m.workbench_connection_to_vault({ vault: "Fixture vault" }));
    press(document.body, m.workbench_connection_disconnect());
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
