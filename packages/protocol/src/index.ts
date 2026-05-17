import type {
  ItemQuery,
  NotifyEvent,
  ProtocolAction,
  ProtocolPayload,
} from "./types";

export type { ItemQuery, NotifyEvent, ProtocolAction, ProtocolPayload };

// Wire-format implementation deferred — see AGENTS.md. The v2 Zotero plugin
// only talks to the v2 Obsidian plugin, so there is no installed-base compat
// constraint pinning the shape; both sides will co-design the encoding when
// the consuming subsystems land. Until then, callers see a loud failure.

const NOT_IMPLEMENTED = new Error(
  "@zotlit/protocol: stringifyQuery / parseQuery not implemented yet — TBD",
);

export function stringifyQuery(
  _action: ProtocolAction,
  _payload: ProtocolPayload,
): string {
  throw NOT_IMPLEMENTED;
}

export function parseQuery(_url: string): {
  action: ProtocolAction;
  payload: ProtocolPayload;
} {
  throw NOT_IMPLEMENTED;
}
