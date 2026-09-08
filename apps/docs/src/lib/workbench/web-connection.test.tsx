// @vitest-environment happy-dom
// Local Bridge transport, resource hydration, credentials, and web Save semantics.
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { BRIDGE_VERSION, LOCAL_BRIDGE_PATHS } from "@zotlit/workbench/bridge";
import { SAMPLE_ITEMS } from "@zotlit/workbench/render";

import { m } from "@/paraglide/messages.js";

import {
  launch,
  BRIDGE_ORIGIN,
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
  it("keeps connection setup in the bottom status control", () => {
    using page = open();
    expect(page.host.querySelector("header")?.textContent).not.toContain(
      m.docs_workbench_not_connected(),
    );
    expect(page.host.querySelector("footer")?.textContent).toContain(
      m.docs_workbench_not_connected(),
    );
    expect(page.host.textContent).not.toContain(
      m.workbench_connection_open_from_obsidian(),
    );
    page.press(m.docs_workbench_not_connected());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      m.workbench_connection_open_from_obsidian(),
    );
    page.press(m.docs_workbench_not_connected());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("connects from a fragment, loads the selected Item, and saves a new revision", async () => {
    const requests: BridgeRequest[] = [];
    vi.stubGlobal("fetch", bridgeFetch(requests));
    using page = launch();

    await page.waitFor(() =>
      expect(title(page.host)).toBe("Connected profile"),
    );
    expect(
      requests.every(
        ({ receiver }) => receiverName(receiver) !== "LocalBridgeClient",
      ),
    ).toBe(true);
    // Nothing but the launch fragment says where the bridge is, so every
    // request rides the port Obsidian bound for this launch.
    expect(new Set(requests.map(({ origin }) => origin))).toEqual(
      new Set([BRIDGE_ORIGIN]),
    );
    expect(page.host.textContent).toContain("Fixture vault");
    expect(page.host.textContent).toContain(m.workbench_save());

    await page.waitFor(() =>
      expect(page.host.textContent).toContain(m.workbench_connected_badge()),
    );
    page.press(m.workbench_refresh_item());
    await page.waitFor(() =>
      expect(
        requests.filter(({ path }) => path === LOCAL_BRIDGE_PATHS.selectedItem),
      ).toHaveLength(2),
    );
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
      expect(
        document.querySelector('[data-slot="toast-viewport"]')?.textContent,
      ).toContain(m.workbench_save_complete({ vault: "Fixture vault" })),
    );
    expect(requests.find(({ path }) => path.endsWith("/save"))?.body).toEqual({
      reference: "profile:default",
      expected: { state: "revision", revision: "revision-1" },
      source: CONNECTED,
    });
    const allowed = new Set([window.location.origin, BRIDGE_ORIGIN]);
    expect(
      [...new Set(requests.map(({ origin }) => origin))].filter(
        (origin) => !allowed.has(origin),
      ),
    ).toEqual([]);
  });

  it("opens the bound group paper even when the Profile names a Sample Item type", async () => {
    const base = SAMPLE_ITEMS[0]!;
    const group = {
      ...base,
      item: {
        ...base.item,
        key: "ITEM2345",
        indexedKey: "ITEM2345g99",
        title: "Group research paper",
      },
    };
    const requests: BridgeRequest[] = [];
    vi.stubGlobal(
      "fetch",
      bridgeFetch(requests, {
        item: () => group,
        source: CONNECTED.replace(
          "language: liquid",
          "language: liquid\nsampleItemType: book",
        ),
      }),
    );
    using page = launch();
    await page.waitFor(() =>
      expect(title(page.host)).toBe("Connected profile"),
    );
    await page.settle();
    expect(page.host.textContent).toContain(m.workbench_connected_badge());
    expect(page.host.textContent).not.toContain(m.workbench_retained_badge());
    expect(startRenderWorker.mock.calls.at(-1)?.[0].snapshot.item.title).toBe(
      "Group research paper",
    );
    page.press(m.workbench_refresh_item());
    await page.waitFor(() =>
      expect(
        requests.filter(({ path }) => path === LOCAL_BRIDGE_PATHS.selectedItem),
      ).toHaveLength(2),
    );
  });

  it("loads the launch paper after the initial Item request failed and reconnect succeeds", async () => {
    const requests: BridgeRequest[] = [];
    vi.stubGlobal("fetch", bridgeFetch(requests, { initialItemFailure: true }));
    using page = launch();
    await page.waitFor(() =>
      expect(page.host.textContent).toContain(
        m.workbench_connection_reconnect(),
      ),
    );
    page.press(m.workbench_connection_reconnect());
    await page.waitFor(() =>
      expect(page.host.textContent).toContain(m.workbench_connected_badge()),
    );
    expect(
      requests.filter(({ path }) => path === LOCAL_BRIDGE_PATHS.selectedItem),
    ).toHaveLength(2);
  });

  it("keeps a deliberate Sample Item choice through reconnect", async () => {
    const requests: BridgeRequest[] = [];
    vi.stubGlobal(
      "fetch",
      bridgeFetch(requests, { itemNetworkFailureOnce: true }),
    );
    using page = launch();
    await page.waitFor(() =>
      expect(title(page.host)).toBe("Connected profile"),
    );
    await page.show(SAMPLE_ITEMS[2]!.item.key);
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
    await page.settle();
    expect(startRenderWorker.mock.calls.at(-1)?.[0].snapshot.item.key).toBe(
      SAMPLE_ITEMS[2]!.item.key,
    );
    expect(
      requests.filter(({ path }) => path === LOCAL_BRIDGE_PATHS.selectedItem),
    ).toHaveLength(2);
  });

  it.each([true, false])(
    "keeps Restore available after hydration with a retained snapshot: %s",
    async (retained) => {
      const scope = "fixture-installation.profile:default";
      localStorage.setItem(
        `zotlit.workbench.draft.${scope}`,
        JSON.stringify({
          source: KEPT,
          ...(retained ? { snapshot: SAMPLE_ITEMS[2] } : {}),
          expected: { state: "revision", revision: "revision-1" },
        }),
      );
      vi.stubGlobal("fetch", bridgeFetch([]));
      using page = launch();
      await page.waitFor(() =>
        expect(title(page.host)).toBe("Connected profile"),
      );
      await page.settle();
      expect(page.host.textContent).toContain(m.workbench_restore_heading());
      page.press(m.workbench_restore_accept());
      await page.settle();
      expect(title(page.host)).toBe("Kept work");
      expect(
        startRenderWorker.mock.calls.at(-1)?.[0].snapshot.provenance.kind,
      ).toBe(retained ? "sample" : "connected");
      if (retained)
        expect(startRenderWorker.mock.calls.at(-1)?.[0].snapshot.item.key).toBe(
          SAMPLE_ITEMS[2]!.item.key,
        );
    },
  );

  it("keeps the persisted draft and Restore offer when the launch paper recovers on reconnect", async () => {
    const key = "zotlit.workbench.draft.fixture-installation.profile:default";
    const kept = JSON.stringify({
      source: KEPT,
      snapshot: SAMPLE_ITEMS[2],
      expected: { state: "revision", revision: "revision-1" },
    });
    localStorage.setItem(key, kept);
    vi.stubGlobal("fetch", bridgeFetch([], { initialItemFailure: true }));
    using page = launch();
    await page.waitFor(() =>
      expect(page.host.textContent).toContain(
        m.workbench_connection_reconnect(),
      ),
    );
    expect(page.host.textContent).toContain(m.workbench_restore_heading());
    page.press(m.workbench_connection_reconnect());
    await page.waitFor(() =>
      expect(page.host.textContent).toContain(m.workbench_connected_badge()),
    );
    await page.settle();
    expect(page.host.textContent).toContain(m.workbench_restore_heading());
    expect(localStorage.getItem(key)).toBe(kept);
    page.press(m.workbench_restore_accept());
    await page.settle();
    expect(title(page.host)).toBe("Kept work");
    expect(startRenderWorker.mock.calls.at(-1)?.[0].snapshot.item.key).toBe(
      SAMPLE_ITEMS[2]!.item.key,
    );
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
    using page = launch();

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

  it("keeps the draft through a lost connection and reconnect", async () => {
    const requests: BridgeRequest[] = [];
    const externalSource = `${CONNECTED}\nExternal Fixture edit`;
    vi.stubGlobal(
      "fetch",
      bridgeFetch(requests, {
        conflictOnce: {
          revision: "external-revision",
          source: externalSource,
        },
        itemNetworkFailureOnce: true,
      }),
    );
    using page = launch();

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

    page.press(m.workbench_refresh_item());
    await page.waitFor(() =>
      expect(page.host.textContent).toContain(
        m.workbench_connection_disconnected_notice(),
      ),
    );
    await page.settle();
    expect(
      JSON.parse(
        localStorage.getItem(
          "zotlit.workbench.draft.fixture-installation.profile:default",
        )!,
      ).expected,
    ).toEqual({ state: "revision", revision: "revision-1" });
    localStorage.removeItem(
      "zotlit.workbench.draft.fixture-installation.profile:default",
    );
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("Site data is blocked.");
    });
    page.press(m.workbench_connection_reconnect());
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
      using page = launch();
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

  it("keeps a refused connection link in the status area with recovery guidance", async () => {
    const requests: BridgeRequest[] = [];
    vi.stubGlobal("fetch", bridgeFetch(requests, { codeRefused: true }));
    using page = launch();

    await page.waitFor(() =>
      expect(page.host.textContent).toContain(
        m.docs_workbench_connection_link_expired(),
      ),
    );

    expect(page.host.querySelector("header")?.textContent).not.toContain(
      m.docs_workbench_connection_link_expired(),
    );
    expect(page.host.querySelector("footer")?.textContent).toContain(
      m.docs_workbench_connection_link_expired(),
    );
    expect(page.host.querySelector("header")?.textContent).not.toContain(
      m.docs_workbench_not_connected(),
    );
    expect(page.host.textContent).not.toContain(
      m.workbench_connection_reconnect(),
    );
    expect(page.host.textContent).toContain(m.workbench_download());
  });

  it("reports a revoked credential and points back to Obsidian", async () => {
    vi.stubGlobal("fetch", bridgeFetch([], { revokeAfterConnect: true }));
    using page = launch();

    await page.waitFor(() =>
      expect(title(page.host)).toBe("Connected profile"),
    );
    page.press(m.workbench_refresh_item());
    await page.waitFor(() =>
      expect(page.host.textContent).toContain(m.workbench_connection_revoked()),
    );

    expect(page.host.textContent).toContain(m.docs_workbench_not_connected());
    expect(page.host.textContent).toContain(m.workbench_download());
  });

  it("opens on a Sample Item when the launch chose none", async () => {
    vi.stubGlobal("fetch", bridgeFetch([], { noSelectedItem: true }));
    using page = launch();

    await page.waitFor(() =>
      expect(title(page.host)).toBe("Connected profile"),
    );

    // The grant names no Item, so the page runs on the Sample Item it opens
    // with and says so, and offers nothing to load from the vault.
    expect(shownItem(page.host)).toBe(SAMPLE_ITEMS[0]!.item.title);
    expect(page.host.textContent).toContain(m.workbench_sample_badge());
    expect(page.host.textContent).not.toContain(m.workbench_load_item());
  });

  it("meets a first connected reader with the Start here strip", async () => {
    vi.stubGlobal("fetch", bridgeFetch([]));
    {
      using page = launch();
      await page.waitFor(() =>
        expect(title(page.host)).toBe("Connected profile"),
      );

      // Three lines and no tour: where the fields are, where the note is
      // written, and where Save sends it.
      expect(page.host.textContent).toContain(m.workbench_start_here_field());
      expect(page.host.textContent).toContain(m.workbench_start_here_note());
      expect(page.host.textContent).toContain(m.workbench_start_here_save());

      page.press(m.workbench_start_here_dismiss());
      expect(page.host.textContent).not.toContain(
        m.workbench_start_here_field(),
      );
    }

    // Dismissed once, dismissed in this browser: the next launch never nags.
    using again = launch();
    await again.waitFor(() =>
      expect(title(again.host)).toBe("Connected profile"),
    );
    expect(again.host.textContent).not.toContain(
      m.workbench_start_here_field(),
    );
  });

  it("shows standalone guidance without claiming a vault connection", async () => {
    using page = open();
    await page.settle();

    // A page nothing opened from Obsidian has no vault to send a note to.
    expect(page.host.textContent).toContain(m.workbench_start_here_field());
    expect(page.host.textContent).not.toContain(m.workbench_start_here_save());
  });

  it("keeps a vault paper for the tab and the draft for the browser", async () => {
    vi.stubGlobal("fetch", bridgeFetch([]));
    using page = launch();

    await page.waitFor(() =>
      expect(title(page.host)).toBe("Connected profile"),
    );
    page.press(m.workbench_refresh_item());
    await page.waitFor(() =>
      expect(page.host.textContent).toContain(m.workbench_connected_badge()),
    );
    page.press(m.workbench_advanced());
    const editor = sourceView(page.host);
    act(() =>
      editor.dispatch({
        changes: { from: editor.state.doc.length, insert: "\nDraft edit" },
      }),
    );
    await page.settle();

    const scope = "fixture-installation.profile:default";
    const record = JSON.parse(
      localStorage.getItem(`zotlit.workbench.draft.${scope}`)!,
    );
    // The reader's own text persists; the paper the vault handed over is the
    // vault's, so on this public origin it lives no longer than the tab.
    expect(record.source).toContain("name: Connected profile");
    expect(record.snapshot).toBeUndefined();
    expect(
      JSON.parse(sessionStorage.getItem(`zotlit.workbench.snapshot.${scope}`)!)
        .provenance,
    ).toEqual({
      kind: "connected",
      installationId: "fixture-installation",
      vault: "Fixture vault",
    });
  });

  it("keeps editing when the bridge reports another contract version", async () => {
    vi.stubGlobal(
      "fetch",
      bridgeFetch([], { bridgeVersion: BRIDGE_VERSION + 1 }),
    );
    using page = launch();

    await page.waitFor(() =>
      expect(page.host.textContent).toContain(
        m.workbench_connection_version_mismatch(),
      ),
    );

    expect(page.host.textContent).toContain(m.docs_workbench_not_connected());
    expect(page.host.textContent).toContain(m.workbench_download());
  });

  it("refetches the citation style when its manifest binding changes", async () => {
    const requests: BridgeRequest[] = [];
    vi.stubGlobal("fetch", bridgeFetch(requests));
    using page = launch();

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
    using page = launch();

    await page.waitFor(() =>
      expect(title(page.host)).toBe("Connected profile"),
    );
    page.press(m.workbench_refresh_item());
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
      expect(
        document.querySelector('[data-slot="toast-viewport"]')?.textContent,
      ).toContain(m.workbench_save_complete({ vault: "Fixture vault" })),
    );
  });

  it("offers Reconnect after the Local Bridge disappears and reuses the credential", async () => {
    const requests: BridgeRequest[] = [];
    vi.stubGlobal(
      "fetch",
      bridgeFetch(requests, { itemNetworkFailureOnce: true }),
    );
    using page = launch();

    await page.waitFor(() =>
      expect(title(page.host)).toBe("Connected profile"),
    );
    page.press(m.workbench_refresh_item());
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
    expect(
      requests.filter(({ path }) => path === LOCAL_BRIDGE_PATHS.codeBootstrap),
    ).toHaveLength(1);
  });

  it("keeps the session credential through a lost connection", async () => {
    vi.stubGlobal("fetch", bridgeFetch([], { itemNetworkFailureOnce: true }));
    {
      using page = launch();
      await page.waitFor(() =>
        expect(title(page.host)).toBe("Connected profile"),
      );
      page.press(m.workbench_refresh_item());
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
    using page = launch();

    await page.waitFor(() =>
      expect(title(page.host)).toBe("Connected profile"),
    );
    page.press(m.workbench_save());
    await page.waitFor(() =>
      expect(
        document.querySelector('[data-slot="toast-viewport"]')?.textContent,
      ).toContain(m.workbench_save_complete({ vault: "Fixture vault" })),
    );

    expect(requests.find(({ path }) => path.endsWith("/save"))?.body).toEqual({
      reference: "profile:default",
      expected: { state: "absent" },
      source: CONNECTED,
    });
    expect(
      document.querySelector('[data-slot="toast-viewport"]')?.textContent,
    ).toContain(m.workbench_save_complete({ vault: "Fixture vault" }));
  });

  it("marks a loaded Item Snapshot as retained after disconnect", async () => {
    vi.stubGlobal("fetch", bridgeFetch([]));
    using page = launch();

    await page.waitFor(() =>
      expect(title(page.host)).toBe("Connected profile"),
    );
    page.press(m.workbench_refresh_item());
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
    // A Connection the reader ended is restarted in Obsidian, not here, so the
    // page says that rather than offering the Reconnect a lost one offers.
    expect(
      document.querySelector('[data-slot="toast-viewport"]')?.textContent,
    ).toContain(m.workbench_connection_disconnect_complete());
    expect(page.host.textContent).not.toContain(
      m.workbench_connection_reconnect(),
    );
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

  it("keeps standalone work separate from a connected profile draft", async () => {
    vi.stubGlobal("fetch", bridgeFetch([]));
    keep(KEPT, SAMPLE_ITEMS[1]!);
    using page = launch();

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

    // The launch opened the vault's document, so the standalone record the
    // last visit left stands under its own key rather than being written over.
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({
      source: KEPT,
    });
    expect(
      JSON.parse(
        localStorage.getItem(
          "zotlit.workbench.draft.fixture-installation.profile:default",
        )!,
      ),
    ).toMatchObject({ source: expect.stringContaining(snippet) });
  });

  it("refuses a profile whose vault partial the web workbench cannot run", async () => {
    vi.stubGlobal("fetch", bridgeFetch([], { etaDependency: true }));
    using page = launch();

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
    using page = launch();

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
    using page = launch();

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
      using page = launch();
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
      requests.filter(({ path }) => path === LOCAL_BRIDGE_PATHS.codeBootstrap),
    ).toHaveLength(1);
    // The grant records the versions it was issued under, so the reload asks
    // the bridge running now rather than trusting the tab's own copy — on the
    // port the tab kept beside the credential.
    const resumes = requests.filter(
      ({ path }) => path === LOCAL_BRIDGE_PATHS.resumeSession,
    );
    expect(resumes).toHaveLength(1);
    expect(resumes[0]?.origin).toBe(BRIDGE_ORIGIN);
  });

  it("refuses a profile whose partial the vault would not hand over", async () => {
    const refusal =
      "Template dependency 'summary' uses an unsupported language.";
    vi.stubGlobal("fetch", bridgeFetch([], { dependencyRefusal: refusal }));
    using page = launch();

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
