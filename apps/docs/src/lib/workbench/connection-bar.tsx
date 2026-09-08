// Connection state and recovery in the Workbench status area.

import {
  ChevronDown,
  LoaderCircle,
  Plug,
  TriangleAlert,
  Unplug,
} from "lucide-react";

import type {
  BridgeCapability,
  LocalBridgeConnection,
} from "@zotlit/workbench/bridge";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverDescription,
  PopoverTrigger,
} from "@/components/ui/popover";
import { m } from "@/paraglide/messages.js";

interface ConnectionBarProps {
  readonly connection: LocalBridgeConnection;
  readonly website: string;
  readonly saveBusy: boolean;
  readonly editingConnectedProfile: boolean;
  readonly busy: boolean;
  /** True while a kept credential and port are still here to present. */
  readonly resumable: boolean;
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
  onReconnect,
  onDisconnect,
}: ConnectionBarProps) {
  const connected = connection.state === "connected";
  return (
    <section
      aria-label={m.workbench_connection_heading()}
      className="flex min-w-0 flex-wrap items-center gap-2"
    >
      {resumable && !connected ? (
        <Button
          variant="outline"
          size="xs"
          disabled={saveBusy || busy}
          onClick={onReconnect}
        >
          {busy ? (
            <LoaderCircle aria-hidden className="motion-safe:animate-spin" />
          ) : (
            <Unplug aria-hidden />
          )}
          {busy
            ? m.workbench_connection_connecting()
            : m.workbench_connection_reconnect()}
        </Button>
      ) : (
        <Popover>
          <PopoverTrigger
            disabled={saveBusy || busy}
            render={
              <Button variant="outline" size="xs" className="max-w-full" />
            }
          >
            {busy ? (
              <LoaderCircle aria-hidden className="motion-safe:animate-spin" />
            ) : connected ? (
              <Plug aria-hidden />
            ) : (
              <Unplug aria-hidden />
            )}
            <span className="max-w-56 min-w-0 truncate text-start">
              {busy
                ? m.workbench_connection_connecting()
                : connected
                  ? m.workbench_connection_to_vault({
                      vault: connection.installation.vault,
                    })
                  : m.docs_workbench_not_connected()}
            </span>
            <ChevronDown aria-hidden />
          </PopoverTrigger>
          <PopoverContent
            side="top"
            className={connected ? "space-y-4" : "space-y-2"}
          >
            <PopoverTitle>{m.workbench_connection_heading()}</PopoverTitle>
            {connected ? (
              <>
                <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-3 gap-y-2">
                  <ConnectionDatum
                    label={m.workbench_connection_vault()}
                    value={connection.installation.vault}
                  />
                  <ConnectionDatum
                    label={m.workbench_connection_profile()}
                    value={connection.selectedProfile.name}
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
                </dl>
                {editingConnectedProfile && (
                  <PopoverDescription>
                    {m.workbench_connection_save_hint()}
                  </PopoverDescription>
                )}
                <details className="group/details">
                  <summary className="flex min-h-6 cursor-pointer list-none items-center gap-1 font-medium [&::-webkit-details-marker]:hidden">
                    <ChevronDown
                      aria-hidden
                      className="size-3.5 shrink-0 -rotate-90 group-open/details:rotate-0 rtl:rotate-90 rtl:group-open/details:rotate-0"
                    />
                    {m.docs_workbench_connection_details()}
                  </summary>
                  <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-3 gap-y-2">
                    <ConnectionDatum
                      label={m.workbench_connection_website()}
                      value={website}
                    />
                    <dt className="text-fd-muted-foreground">
                      {m.workbench_connection_access()}
                    </dt>
                    <dd>
                      <ul className="space-y-1">
                        {connection.capabilities.map((capability) => (
                          <li key={capability}>
                            {CAPABILITY_LABEL[capability]()}
                          </li>
                        ))}
                      </ul>
                    </dd>
                  </dl>
                </details>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={busy || saveBusy}
                  onClick={onDisconnect}
                >
                  <Unplug aria-hidden />
                  {m.workbench_connection_disconnect()}
                </Button>
              </>
            ) : (
              <PopoverDescription>
                {m.workbench_connection_open_from_obsidian()}
              </PopoverDescription>
            )}
          </PopoverContent>
        </Popover>
      )}
    </section>
  );
}

export function ConnectionNotice({
  connection,
  message,
}: {
  readonly connection: LocalBridgeConnection;
  readonly message: string | null;
}) {
  const text =
    message ??
    (connection.state === "unavailable" ? connectionStatus(connection) : null);
  return (
    <div role="status" className="shrink-0 empty:hidden">
      {text && (
        <div className="flex items-start gap-2 border-s-2 border-b border-s-fd-primary border-b-fd-border bg-fd-accent/40 px-3 py-2 text-xs leading-normal">
          <TriangleAlert
            aria-hidden
            className="mt-0.5 size-3.5 shrink-0 text-fd-primary"
          />
          <p className="min-w-0 text-pretty break-words">{text}</p>
        </div>
      )}
    </div>
  );
}

function connectionStatus(
  connection: Extract<LocalBridgeConnection, { state: "unavailable" }>,
): string {
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
    <>
      <dt className="text-fd-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </>
  );
}
