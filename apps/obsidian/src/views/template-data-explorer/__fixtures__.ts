// A test host for the Template Data Explorer: one Explorer model in the
// plugin's view registry, over Template data reads and Zotero changes the test
// drives.
import { Effect, Layer, Queue, Stream } from "effect";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import type { ContractRoot } from "@zotlit/db";
import type { TemplateRoot, WorkbenchItemChoice } from "@zotlit/workbench/ui";

import { layerHost } from "@/lib/__fixtures__/obsidian-host-app";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { layerUnreadViewServices } from "@/lib/__fixtures__/view-atoms";
import { buildRuntime } from "@/lib/effect-layer";
import { makeViewRegistry } from "@/lib/view-atoms";
import { yieldToMain } from "@/lib/yield-to-main";
import { TemplateDataError } from "@/services/template-workbench/data";
import type {
  TemplateDataLoader,
  TemplateDataLoadResult,
} from "@/services/template-workbench/data";
import { TemplateDataReads } from "@/services/template-workbench/data-reads";
import { ZoteroReads } from "@/services/zotero-reads/service";
import type { ZoteroReadsEvent } from "@/services/zotero-reads/service";
import type { TemplateAuthoringContext } from "@/views/template-workbench/view";

import {
  holdExplorerModel,
  makeExplorerModel,
  refresh,
  setContext,
  setTarget,
} from "./model";
import type { ExplorerModel, ExplorerSession, ExplorerState } from "./model";

/** The Template data reads, as promises the test resolves. */
export interface ExplorerReads {
  read?(
    indexedKey: string,
    root: ContractRoot,
  ): Promise<TemplateDataLoadResult>;
  readCitation?: TemplateDataLoader["loadCitation"];
}

export interface ExplorerHost {
  readonly registry: AtomRegistry.AtomRegistry;
  /** The Indexed Key of each read the Explorer interrupted, in order. */
  readonly cancelled: readonly string[];
  /** Sends a Zotero database change to every Explorer in the registry. */
  changeZotero(): void;
  /** How many Zotero change subscriptions are live. */
  zoteroSubscribers(): number;
  /** One more Explorer model, held until the session's dispose. */
  openSession(): ExplorerSessionHandle;
  close(): Promise<void>;
}

/** One Explorer model, driven as the view drives it. */
export interface ExplorerSessionHandle extends Disposable {
  readonly model: ExplorerModel;
  state(): ExplorerState;
  apply(transition: (session: ExplorerSession) => ExplorerSession): void;
  setTarget(
    item: WorkbenchItemChoice | null,
    root: TemplateRoot,
    annotationId?: string | null,
  ): void;
  setContext(context: TemplateAuthoringContext): void;
  refresh(): void;
  /** Waits until the load the last change started has its last read. */
  ready(): Promise<void>;
}

/** Retries `assertion` across host turns until it holds. */
export async function waitFor(assertion: () => void): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      if (attempt === 999) throw error;
      await yieldToMain();
    }
  }
}

/** A read that waits for `promise`, interruptible as the real read is. */
const fromPromise = <A>(evaluate: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({
    try: (signal) => evaluate(signal),
    catch: (cause) => new TemplateDataError({ cause }),
  });

export async function makeExplorerHost(
  reads: ExplorerReads = {},
): Promise<ExplorerHost> {
  const stack = new AsyncDisposableStack();
  const zotero = new Set<() => void>();
  const cancelled: string[] = [];
  const runtime = buildRuntime(
    Layer.mergeAll(
      layerUnreadViewServices,
      layerHost(),
      Layer.mock(TemplateDataReads, {
        read: (indexedKey, root) =>
          fromPromise((signal) => {
            signal.addEventListener("abort", () => cancelled.push(indexedKey));
            return reads.read
              ? reads.read(indexedKey, root)
              : Promise.reject(new Error(`no read for ${indexedKey}`));
          }),
        readCitation: (selector, variant) =>
          fromPromise(() =>
            reads.readCitation
              ? reads.readCitation(selector, variant)
              : Promise.reject(new Error("no Citation read")),
          ),
      }),
      Layer.mock(ZoteroReads, {
        reads: stubService<ZoteroReads["Service"]["reads"]>(
          "ZoteroReadsApi",
          {},
        ),
        events: Stream.callback<ZoteroReadsEvent>((queue) =>
          Effect.acquireRelease(
            Effect.sync(() => {
              const send = () => {
                Queue.offerUnsafe(queue, { _tag: "changed" });
              };
              zotero.add(send);
              return send;
            }),
            (send) => Effect.sync(() => zotero.delete(send)),
          ),
        ),
      }),
    ),
    stack,
  );
  const registry = makeViewRegistry(await runtime.context(), { idleTTL: 0 });
  return {
    registry,
    cancelled,
    changeZotero: () => {
      for (const send of zotero) send();
    },
    zoteroSubscribers: () => zotero.size,
    openSession: () => {
      const model = makeExplorerModel();
      const release = holdExplorerModel(registry, model);
      const apply = (
        transition: (session: ExplorerSession) => ExplorerSession,
      ) => registry.update(model.session, transition);
      return {
        model,
        state: () => registry.get(model.state),
        apply,
        setTarget: (item, root, annotationId = null) =>
          apply(setTarget(item, root, annotationId)),
        setContext: (context) => apply(setContext(context)),
        refresh: () => apply(refresh),
        ready: () =>
          waitFor(() => {
            if (registry.get(model.loaded).waiting)
              throw new Error("The Explorer still reads its data");
          }),
        [Symbol.dispose]: release,
      };
    },
    close: async () => {
      registry.dispose();
      await stack.disposeAsync();
    },
  };
}
