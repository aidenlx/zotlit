// The header's connection control, with identity and permissions in its popover.

import { Popover } from "@base-ui/react/popover";
import { ChevronDown, Unplug, X } from "lucide-react";

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
  /** True while a kept credential and port are still here to present. */
  readonly resumable: boolean;
  readonly message: string | null;
  readonly onReconnect: () => void;
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
  resumable,
  message,
  onReconnect,
  onDisconnect,
}: ConnectionBarProps) {
  const connected = connection.state === "connected";
  return (
    <section
      aria-label={m.workbench_connection_heading()}
      className="flex min-w-0 flex-wrap items-center gap-2"
    >
      {connected ? (
        <Popover.Root>
          <Popover.Trigger
            render={
              <Button variant="outline" size="xs" className="max-w-full" />
            }
          >
            <span
              className="size-1.5 shrink-0 rounded-full bg-fd-primary"
              aria-hidden
            />
            <span className="min-w-0 text-start break-words">
              {m.workbench_connection_to_vault({
                vault: connection.installation.vault,
              })}
            </span>
            <ChevronDown aria-hidden />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner
              side="bottom"
              align="end"
              sideOffset={6}
              className="z-50"
            >
              <Popover.Popup className="max-h-(--available-height) w-96 max-w-[calc(100vw-2rem)] space-y-3 overflow-auto rounded-md border border-fd-border bg-fd-popover p-3 text-fd-popover-foreground shadow-lg">
                <div className="flex items-center justify-between gap-3">
                  <Popover.Title className="text-sm font-semibold">
                    {m.workbench_connection_heading()}
                  </Popover.Title>
                  <Popover.Close
                    render={<Button variant="ghost" size="icon-sm" />}
                    aria-label={m.workbench_fields_close()}
                  >
                    <X aria-hidden />
                  </Popover.Close>
                </div>
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
                      connection.selectedItem === null
                        ? m.workbench_sample_badge()
                        : (connection.selectedItem.title ??
                          connection.selectedItem.key)
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
                {editingConnectedProfile && (
                  <p className="text-sm leading-normal text-fd-muted-foreground">
                    {m.workbench_connection_save_hint()}
                  </p>
                )}
                <Button
                  variant="outline"
                  size="xs"
                  disabled={busy || saveBusy}
                  onClick={onDisconnect}
                >
                  <Unplug aria-hidden />
                  {m.workbench_connection_disconnect()}
                </Button>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      ) : resumable ? (
        <Button
          variant="outline"
          size="xs"
          title={connectionStatus(connection)}
          disabled={saveBusy || busy}
          onClick={onReconnect}
        >
          {busy
            ? m.workbench_connection_connecting()
            : m.workbench_connection_reconnect()}
        </Button>
      ) : (
        // A Workbench Connection starts in Obsidian, so a page holding nothing
        // to present says where to start it rather than offering a Connect
        // button no plugin can honour.
        <p className="max-w-prose text-sm leading-normal text-pretty text-fd-muted-foreground">
          {m.workbench_connection_open_from_obsidian()}
        </p>
      )}
      <p
        role="status"
        className="max-w-prose basis-full text-sm leading-normal text-pretty empty:hidden"
      >
        {message ??
          (connection.state === "unavailable"
            ? connectionStatus(connection)
            : null)}
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
