// The Local Bridge identity, permissions, and connection actions shown above the Workbench.

import type {
  BridgeCapability,
  LocalBridgeConnection,
} from "@zotlit/workbench/bridge";

import { Button } from "@/components/ui/button";
import { m } from "@/paraglide/messages.js";

interface ConnectionBarProps {
  readonly connection: LocalBridgeConnection;
  readonly website: string;
  readonly saveBusy: boolean;
  readonly editingConnectedProfile: boolean;
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
  saveBusy,
  editingConnectedProfile,
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
      className="shrink-0 border-b border-fd-border bg-fd-muted/50 px-4 py-2 min-[780px]:px-6"
    >
      <div className="flex flex-col items-start justify-between gap-x-4 gap-y-2 sm:flex-row sm:flex-wrap sm:items-center">
        {connected ? (
          <details className="min-w-0 flex-1">
            <summary className="cursor-pointer text-sm">
              {m.workbench_connection_to_vault({
                vault: connection.installation.vault,
              })}
            </summary>
            <div className="mt-3 space-y-3 pb-2">
              <dl className="flex flex-col gap-2 text-sm text-fd-muted-foreground">
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
              <Button
                variant="outline"
                size="sm"
                disabled={busy || saveBusy}
                onClick={onDisconnect}
              >
                {m.workbench_connection_disconnect()}
              </Button>
            </div>
          </details>
        ) : (
          <p className="min-w-0 flex-1 text-sm text-fd-muted-foreground">
            {connectionStatus(connection)}
          </p>
        )}
        {connected && editingConnectedProfile && (
          <p className="text-xs text-fd-muted-foreground">
            {m.workbench_connection_save_hint()}
          </p>
        )}
        {!connected && (
          <Button
            variant="outline"
            size="sm"
            disabled={saveBusy || (busy && !cancellable)}
            onClick={onAction}
          >
            {connectionButtonLabel(connection, busy, cancellable)}
          </Button>
        )}
      </div>
      <p
        role="status"
        className="text-sm leading-relaxed not-empty:mt-2 empty:hidden"
      >
        {message}
      </p>
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
    <div className="flex flex-wrap gap-x-2">
      <dt className="font-medium text-fd-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
}
