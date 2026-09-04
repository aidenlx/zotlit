// The Local Bridge identity, permissions, and connection actions shown above the Workbench.

import type {
  BridgeCapability,
  LocalBridgeConnection,
} from "@zotlit/workbench/bridge";

import { m } from "@/paraglide/messages.js";

interface ConnectionBarProps {
  readonly connection: LocalBridgeConnection;
  readonly website: string;
  readonly busy: boolean;
  readonly cancellable: boolean;
  readonly message: string | null;
  readonly onConnect: () => void;
  readonly onCancel: () => void;
  readonly onDisconnect: () => void;
}

const CAPABILITY_LABEL = {
  "template-schema:read": m.workbench_connection_capability_template_schema,
  "selected-item:read": m.workbench_connection_capability_selected_item,
  "selected-profile:read": m.workbench_connection_capability_selected_profile,
  "selected-profile:save": m.workbench_connection_capability_save_profile,
  "template-dependencies:read":
    m.workbench_connection_capability_template_dependencies,
  "citation-styles:list": m.workbench_connection_capability_citation_styles,
  "selected-citation-style:read":
    m.workbench_connection_capability_selected_citation_style,
} satisfies Record<BridgeCapability, () => string>;

export function ConnectionBar({
  connection,
  website,
  busy,
  cancellable,
  message,
  onConnect,
  onCancel,
  onDisconnect,
}: ConnectionBarProps) {
  const connected = connection.state === "connected";
  let onAction = onConnect;
  if (connected) onAction = onDisconnect;
  if (busy) onAction = onCancel;
  return (
    <section
      aria-label={m.workbench_connection_heading()}
      className="shrink-0 border-b border-fd-border bg-fd-accent/25 px-4 py-3 min-[780px]:px-6"
    >
      <div className="flex flex-wrap items-start gap-x-5 gap-y-2">
        <div className="min-w-56 flex-1">
          <p className="font-mono text-[0.68rem] font-semibold tracking-widest text-fd-primary uppercase">
            {m.workbench_connection_heading()}
          </p>
          {connected ? (
            <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fd-muted-foreground">
              <ConnectionDatum
                label={m.workbench_connection_website()}
                value={website}
              />
              <ConnectionDatum
                label={m.workbench_connection_vault()}
                value={connection.installation.vault}
              />
              <ConnectionDatum
                label={m.workbench_connection_item()}
                value={
                  connection.selectedItem.title ?? connection.selectedItem.key
                }
              />
              <ConnectionDatum
                label={m.workbench_connection_profile()}
                value={connection.selectedProfile.name}
              />
              <ConnectionDatum
                label={m.workbench_connection_access()}
                value={connection.capabilities
                  .map((capability) => CAPABILITY_LABEL[capability]())
                  .join(", ")}
              />
            </dl>
          ) : (
            <p className="mt-1 text-sm text-fd-muted-foreground">
              {connectionStatus(connection)}
            </p>
          )}
          {message && (
            <p aria-live="polite" className="mt-2 text-sm font-medium">
              {message}
            </p>
          )}
        </div>
        <button
          type="button"
          disabled={busy && !cancellable}
          onClick={onAction}
          className="cursor-pointer border border-fd-border bg-fd-card px-3 py-1.5 text-sm font-medium disabled:cursor-wait disabled:text-fd-muted-foreground"
        >
          {connectionButtonLabel(connection, busy, cancellable)}
        </button>
      </div>
    </section>
  );
}

function connectionStatus(connection: LocalBridgeConnection): string {
  if (connection.state !== "unavailable") {
    return m.workbench_connection_disconnected();
  }
  switch (connection.reason) {
    case "connection-lost":
      return m.workbench_connection_disconnected_notice();
    case "revoked":
      return m.workbench_connection_revoked();
    case "version-mismatch":
      return m.workbench_connection_version_mismatch();
  }
}

function connectionButtonLabel(
  connection: LocalBridgeConnection,
  busy: boolean,
  cancellable: boolean,
): string {
  if (busy) {
    return cancellable
      ? m.workbench_connection_cancel()
      : m.workbench_connection_connecting();
  }
  if (connection.state === "connected") {
    return m.workbench_connection_disconnect();
  }
  if (connection.state === "unavailable") {
    return m.workbench_connection_reconnect();
  }
  return m.workbench_connection_connect();
}

function ConnectionDatum({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="flex gap-1">
      <dt className="font-medium text-fd-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
