// The Workbench Connection state machine: bootstrap, hydration, refresh, Save, and disconnect.

import { useCallback, useEffect, useRef, useState } from "react";

import {
  BRIDGE_VERSION,
  LOCAL_BRIDGE_ORIGIN,
  LocalBridgeClient,
  LocalBridgeProtocolError,
  LocalBridgeUnavailableError,
} from "@zotlit/workbench/bridge";
import type {
  InstalledCitationStyle,
  LocalBridgeConnection,
  SaveSelectedProfileRequest,
  SaveSelectedProfileResponse,
  SelectedProfileResponse,
} from "@zotlit/workbench/bridge";
import type { WorkbenchDocumentController } from "@zotlit/workbench/document";
import type { RenderResources } from "@zotlit/workbench/render";

import { m } from "@/paraglide/messages.js";

import type { SampleItem } from "./fields";
import { readDraft } from "./transfer";
import type { WorkbenchDraft } from "./transfer";

export interface ProfileHydration {
  readonly selected: SelectedProfileResponse;
  readonly kept: WorkbenchDraft | null;
}

interface SavedProfile {
  readonly reference: string;
  readonly revision: string;
  readonly source: string;
}

interface UseWorkbenchConnectionOptions {
  readonly controller: WorkbenchDocumentController;
  readonly sample: SampleItem;
  readonly onHydrate: (hydration: ProfileHydration) => void;
  readonly onItemLoaded: (snapshot: SampleItem) => void;
  readonly onSaved: (profile: SavedProfile) => void;
}

interface SaveTarget {
  readonly reference: string;
  readonly expected: SaveSelectedProfileRequest["expected"];
}

export function useWorkbenchConnection({
  controller,
  sample,
  onHydrate,
  onItemLoaded,
  onSaved,
}: UseWorkbenchConnectionOptions) {
  const [bridge] = useState(
    () =>
      new LocalBridgeClient({
        baseUrl: LOCAL_BRIDGE_ORIGIN,
        compatibility: {
          bridgeVersion: BRIDGE_VERSION,
          templateDataContractVersion: sample.contractVersion,
        },
      }),
  );
  const [connection, setConnection] = useState<LocalBridgeConnection>(
    bridge.connection,
  );
  const [saveTarget, setSaveTarget] = useState<SaveTarget | null>(null);
  const [resources, setResources] = useState<RenderResources | undefined>();
  const [citationStyles, setCitationStyles] = useState<
    readonly InstalledCitationStyle[] | null
  >(null);
  const [loadedStyleId, setLoadedStyleId] = useState<string | null>();
  // The partial names the held bundle answers. Null until the first settle
  // records what the hydrated document calls.
  const loadedDependencies = useRef<string | null>(null);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [connectionCancellable, setConnectionCancellable] = useState(false);
  const [itemBusy, setItemBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const connectionAbort = useRef<AbortController | null>(null);

  const resetConnectedState = useCallback(() => {
    setSaveTarget(null);
    setResources(undefined);
    setCitationStyles(null);
    setLoadedStyleId(undefined);
    loadedDependencies.current = null;
  }, []);

  const connectionFailed = useCallback(
    (error: unknown) => {
      const next = bridge.connection;
      if (next.state !== "connected") resetConnectedState();
      setConnection(next);
      setMessage(connectionFailureMessage(error, next));
    },
    [bridge, resetConnectedState],
  );

  async function hydrateConnection(): Promise<void> {
    const selected = await bridge.readSelectedProfile();
    // The vault's own default, until the document this hydration opens says
    // which style it binds: the settle effect below reads that binding from the
    // page's own controller, so hydration parses nothing of its own.
    const styleId = null;
    const [dependencies, citationStyle, styles] = await Promise.all([
      bridge.readTemplateDependencies({ source: selected.source }),
      bridge.readSelectedCitationStyle({ styleId }),
      readCitationStyles(),
    ]);
    // The bundle answers the source this hydration opens, and the settle effect
    // below reads it again once the draft calls a different set of partials.
    loadedDependencies.current = null;
    const reference = selected.document.reference;
    const currentExpected = expectedRevision(selected.document);
    const kept = readDraft(reference);

    setResources({ dependencies, citationStyle });
    setCitationStyles(styles);
    setLoadedStyleId(styleId);
    setSaveTarget({ reference, expected: currentExpected });

    onHydrate({ selected, kept });
    if (
      kept?.expected &&
      !sameExpectedRevision(kept.expected, currentExpected)
    ) {
      setMessage(m.workbench_save_conflict());
    }
  }

  /**
   * The styles the vault has installed, so the citation-style binding is picked
   * from a list rather than typed. A vault that granted no listing, or a bridge
   * that refused it, leaves the binding as a typed CSL ID instead of costing the
   * whole hydration; a lost connection still fails the hydration it belongs to.
   */
  async function readCitationStyles(): Promise<
    readonly InstalledCitationStyle[] | null
  > {
    const grant = bridge.connection;
    if (
      grant.state !== "connected" ||
      !grant.capabilities.includes("citation-styles:list")
    ) {
      return null;
    }
    try {
      return await bridge.listCitationStyles();
    } catch (error) {
      if (error instanceof LocalBridgeProtocolError) return null;
      throw error;
    }
  }

  async function connect(
    run: () => Promise<LocalBridgeConnection>,
    abort?: AbortController,
  ) {
    setConnectionBusy(true);
    setConnectionCancellable(abort !== undefined);
    setMessage(null);
    try {
      const next = await run();
      setConnection(next);
      if (next.state === "connected") await hydrateConnection();
    } catch (error) {
      if (!abort?.signal.aborted) connectionFailed(error);
    } finally {
      if (connectionAbort.current === abort) {
        connectionAbort.current = null;
        setConnectionCancellable(false);
      }
      setConnectionBusy(false);
    }
  }

  function connectFromPage() {
    const abort = new AbortController();
    connectionAbort.current = abort;
    void connect(
      async () =>
        // A transport failure kept the grant, so Reconnect presents it to the
        // bridge running now — which re-checks compatibility against this page
        // — instead of asking for a fresh approval. A tab that kept no grant
        // falls through to the loopback approval.
        (await bridge.resume({ signal: abort.signal })) ??
        (await bridge.connectFromLoopback({ signal: abort.signal })),
      abort,
    );
  }

  async function disconnect() {
    setConnectionBusy(true);
    try {
      await bridge.disconnect();
      resetConnectedState();
      setConnection(bridge.connection);
      setMessage(m.workbench_connection_disconnected_notice());
    } catch (error) {
      connectionFailed(error);
    } finally {
      setConnectionBusy(false);
    }
  }

  async function loadSelectedItem() {
    setItemBusy(true);
    setMessage(null);
    try {
      onItemLoaded(await bridge.loadSelectedItem());
    } catch (error) {
      connectionFailed(error);
    } finally {
      setItemBusy(false);
    }
  }

  async function save(source: string) {
    if (!saveTarget) return;
    setSaveBusy(true);
    setMessage(null);
    try {
      const saved = await bridge.saveSelectedProfile({ ...saveTarget, source });
      if (saved.state === "refused") {
        setMessage(saveRefusalMessage(saved.reason));
        return;
      }
      const expected = {
        state: "revision" as const,
        revision: saved.revision,
      };
      setSaveTarget({ reference: saveTarget.reference, expected });
      onSaved({
        reference: saveTarget.reference,
        revision: saved.revision,
        source,
      });
      setMessage(m.workbench_save_complete({ revision: saved.revision }));
    } catch (error) {
      connectionFailed(error);
    } finally {
      setSaveBusy(false);
    }
  }

  useEffect(() => {
    const fragment = window.location.hash;
    if (new URLSearchParams(fragment.slice(1)).has("zotlit-connect")) {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
      void connect(() => bridge.connectFromFragment(fragment));
      return;
    }
    if (bridge.connection.state === "connected") {
      void connect(async () => bridge.connection);
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- bootstraps once against `bridge`, not on every `connect` identity change
  }, [bridge]);

  // A page the reader leaves mid-approval stops polling with them: the loopback
  // bootstrap runs until it is approved or aborted, and nothing outlives the
  // hook that started it.
  useEffect(() => () => connectionAbort.current?.abort(), []);

  // The partials the draft calls right now. A bundle is read again only when
  // this list changes, so typing never queries the vault.
  const dependencyNames = controller.dependencies.join("\u0000");
  useEffect(() => {
    if (connection.state !== "connected" || !resources) return;
    if (loadedDependencies.current === null) {
      // The hydration's own bundle answers the document it opened.
      loadedDependencies.current = dependencyNames;
      return;
    }
    if (loadedDependencies.current === dependencyNames) return;
    let current = true;
    void bridge
      .readTemplateDependencies({ source: controller.source })
      .then((dependencies) => {
        if (!current) return;
        loadedDependencies.current = dependencyNames;
        setResources((held) => (held ? { ...held, dependencies } : held));
      })
      .catch((error: unknown) => {
        if (current) connectionFailed(error);
      });
    return () => {
      current = false;
    };
  }, [
    bridge,
    connection,
    connectionFailed,
    controller,
    dependencyNames,
    resources,
  ]);

  const styleId = controller.document
    ? (controller.document.manifest.citationStyle ?? null)
    : undefined;
  useEffect(() => {
    if (
      connection.state !== "connected" ||
      !resources ||
      styleId === undefined ||
      loadedStyleId === styleId
    ) {
      return;
    }
    let current = true;
    void bridge
      .readSelectedCitationStyle({ styleId })
      .then((citationStyle) => {
        if (!current) return;
        setResources((held) => (held ? { ...held, citationStyle } : held));
        setLoadedStyleId(styleId);
      })
      .catch((error: unknown) => {
        if (current) connectionFailed(error);
      });
    return () => {
      current = false;
    };
  }, [bridge, connection, connectionFailed, loadedStyleId, resources, styleId]);

  return {
    connection,
    saveTarget,
    resources,
    citationStyles,
    connectionBusy,
    connectionCancellable,
    itemBusy,
    saveBusy,
    message,
    connectFromPage,
    cancelConnection: () => connectionAbort.current?.abort(),
    disconnect,
    loadSelectedItem,
    save,
  };
}

function connectionFailureMessage(
  error: unknown,
  connection: LocalBridgeConnection,
): string {
  if (
    error instanceof LocalBridgeUnavailableError &&
    connection.state === "unavailable"
  ) {
    if (connection.reason === "version-mismatch") {
      return m.workbench_connection_version_mismatch();
    }
    if (connection.reason === "revoked") {
      return m.workbench_connection_revoked();
    }
  }
  if (
    connection.state === "unavailable" &&
    connection.reason === "connection-lost"
  ) {
    return m.workbench_connection_disconnected_notice();
  }
  return m.workbench_connection_failed({ message: errorMessage(error) });
}

function expectedRevision(
  document: SelectedProfileResponse["document"],
): SaveSelectedProfileRequest["expected"] {
  return document.state === "present"
    ? { state: "revision", revision: document.revision }
    : { state: "absent" };
}

function sameExpectedRevision(
  left: SaveSelectedProfileRequest["expected"],
  right: SaveSelectedProfileRequest["expected"],
): boolean {
  return (
    left.state === right.state &&
    (left.state === "absent" ||
      (right.state === "revision" && left.revision === right.revision))
  );
}

function saveRefusalMessage(
  reason: Exclude<SaveSelectedProfileResponse, { state: "saved" }>["reason"],
): string {
  switch (reason) {
    case "revision-conflict":
      return m.workbench_save_conflict();
    case "document-exists":
      return m.workbench_save_document_exists();
    case "invalid-source":
      return m.workbench_save_invalid();
    case "unsupported-profile":
      return m.workbench_save_unsupported();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
