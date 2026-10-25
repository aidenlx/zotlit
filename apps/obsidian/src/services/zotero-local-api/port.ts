// The Local API as the Annotation Repository and CapabilityNotices read it: synchronous reads, Promises, and events.
import type { EffectBridge } from "@/lib/effect-bridge";

import type { AuthorizedSendOptions, ZoteroLocalApi } from "./service";
import type {
  LocalApiAnnotation,
  LocalApiFailure,
  LocalApiResult,
  LocalApiSource,
  LocalApiState,
  WriteAuthorizationState,
} from "./session";
import type { ZoteroReply } from "./wire";

export interface LocalApiPort {
  demandSource(): LocalApiSource | null;
  readonly state: LocalApiState;
  probe(): Promise<void>;
  writeStateFor(attachmentKey: string | null): WriteAuthorizationState;
  authorize(signal?: AbortSignal): Promise<LocalApiResult<void>>;
  authorizedSend(
    path: string,
    options: AuthorizedSendOptions,
  ): Promise<LocalApiResult<ZoteroReply>>;
  readAnnotation(
    annotationKey: string,
    attachmentKey: string,
    signal?: AbortSignal,
  ): Promise<LocalApiResult<LocalApiAnnotation>>;
  listAnnotations(
    attachmentKey: string,
    signal?: AbortSignal,
  ): Promise<LocalApiResult<readonly LocalApiAnnotation[]>>;
  on<K extends keyof LocalApiPortEvents>(
    event: K,
    callback: LocalApiPortEvents[K],
  ): () => void;
}

export interface LocalApiPortEvents {
  changed: () => void;
  "capability-changed": () => void;
  "write-refused": (failure: LocalApiFailure, library: string) => void;
  "server-changed": (serverID: string) => void;
  "write-refusals-retired": () => void;
}

/** The synchronous view the Annotation Repository reads until it converts. */
export function localApiPort(
  api: ZoteroLocalApi["Service"],
  bridge: Pick<EffectBridge, "runSync" | "runPromise" | "subscribe">,
): LocalApiPort {
  return {
    demandSource: () => bridge.runSync(api.demandSource()),
    get state() {
      return bridge.runSync(api.state);
    },
    probe: () => bridge.runPromise(api.probe()),
    writeStateFor: (attachmentKey) =>
      bridge.runSync(api.writeStateFor(attachmentKey)),
    authorize: (signal) => bridge.runPromise(api.authorize(signal)),
    authorizedSend: (path, options) =>
      bridge.runPromise(api.authorizedSend(path, options)),
    readAnnotation: (annotationKey, attachmentKey, signal) =>
      bridge.runPromise(
        api.readAnnotation(annotationKey, attachmentKey, signal),
      ),
    listAnnotations: (attachmentKey, signal) =>
      bridge.runPromise(api.listAnnotations(attachmentKey, signal)),
    on: (event, callback) => {
      switch (event) {
        case "changed":
          return bridge.subscribe(api.changes, () =>
            (callback as LocalApiPortEvents["changed"])(),
          );
        case "capability-changed":
          return bridge.subscribe(api.capabilityChanges, () =>
            (callback as LocalApiPortEvents["capability-changed"])(),
          );
        case "write-refused":
          return bridge.subscribe(api.writeRefusals, (value) =>
            (callback as LocalApiPortEvents["write-refused"])(
              value.failure,
              value.library,
            ),
          );
        case "server-changed":
          return bridge.subscribe(api.serverChanges, (serverID) =>
            (callback as LocalApiPortEvents["server-changed"])(serverID),
          );
        case "write-refusals-retired":
          return bridge.subscribe(api.writeRefusalsRetired, () =>
            (callback as LocalApiPortEvents["write-refusals-retired"])(),
          );
      }
    },
  };
}
