// The Workbench's state seam and service dependencies.
import { expect, it } from "@effect/vitest";
import { Effect, Stream, SubscriptionRef } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { TFile } from "obsidian";
import type { App } from "obsidian";
import { vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import type { MetadataEvent } from "@/lib/obsidian-metadata-cache";
import { fileProfileAtom } from "@/services/profile/atoms";
import { defaultBindingsAtom } from "@/services/settings/atoms";
import { defaults } from "@/services/settings/schema";
import {
  partialDocumentsAtom,
  templateRevisionAtom,
} from "@/services/template/atoms";
import { waitFor } from "@/views/template-data-explorer/__fixtures__";

import { makeWorkbenchHost } from "./__fixtures__";
import type { WorkbenchHostDeps } from "./__fixtures__";
import {
  holdWorkbenchModel,
  makeWorkbenchModel,
  patchWorkbench,
  workbenchStore,
} from "./model";

it.effect(
  "holds layout state before open and keeps the shared store interface",
  () =>
    Effect.gen(function* () {
      const host = yield* Effect.sync(() => makeWorkbenchHost());
      const model = makeWorkbenchModel();
      const release = holdWorkbenchModel(host.registry, model);
      const store = workbenchStore(host.registry, model);
      const listener = vi.fn();
      const unsubscribe = store.subscribe(listener);
      store.getState().setTab("annotation");
      expect(host.registry.get(model.state).tab).toBe("annotation");
      expect(store.getState().tab).toBe("annotation");
      const before = host.registry.get(model.state);
      expect(patchWorkbench({ tab: "annotation" })(before)).toBe(before);
      expect(listener).toHaveBeenCalledOnce();
      unsubscribe();
      release();
    }),
);

it.effect(
  "reloads partial names on compilation and leaves them held on local presentation changes",
  () =>
    Effect.gen(function* () {
      const revision = yield* SubscriptionRef.make(0);
      const read = vi.fn(() => []);
      const host = makeWorkbenchHost({
        templates: stubService<WorkbenchHostDeps["templates"]>("Template", {
          loaded: true,
          getPartialDocuments: read,
          "compile-status-changed": Stream.map(
            Stream.drop(SubscriptionRef.changes(revision), 1),
            () => undefined,
          ),
        }),
      });
      const release = host.registry.mount(partialDocumentsAtom);
      const ready = () =>
        waitFor(() => {
          const result = host.registry.get(partialDocumentsAtom);
          expect(AsyncResult.isSuccess(result) && !result.waiting).toBe(true);
        });
      yield* Effect.promise(() => ready());
      const count = read.mock.calls.length;
      const model = makeWorkbenchModel();
      const releaseModel = holdWorkbenchModel(host.registry, model);
      host.registry.update(model.state, patchWorkbench({ advanced: true }));
      expect(read).toHaveBeenCalledTimes(count);
      const before = host.registry.get(templateRevisionAtom);
      yield* SubscriptionRef.set(revision, 1);
      yield* Effect.promise(() =>
        waitFor(() =>
          expect(host.registry.get(templateRevisionAtom)).toBe(before + 1),
        ),
      );
      yield* Effect.promise(() => ready());
      expect(read).toHaveBeenCalledTimes(count + 1);
      releaseModel();
      release();
    }),
);

it.effect("keeps default bindings stable when another setting changes", () =>
  Effect.gen(function* () {
    const settings = yield* SubscriptionRef.make(defaults);
    const host = makeWorkbenchHost({
      settings: {
        current: SubscriptionRef.get(settings),
        changes: SubscriptionRef.changes(settings),
      },
    });
    const values: unknown[] = [];
    const release = host.registry.subscribe(
      defaultBindingsAtom,
      (value) => values.push(value),
      { immediate: true },
    );
    const before = host.registry.get(defaultBindingsAtom);
    yield* SubscriptionRef.set(settings, {
      ...defaults,
      "template.folder": "other-templates",
    });
    // The folder read is the completion signal for the same settings event.
    const { templateFolderAtom } = yield* Effect.promise(
      () => import("@/services/settings/atoms"),
    );
    const releaseFolder = host.registry.mount(templateFolderAtom);
    yield* Effect.promise(() =>
      waitFor(() =>
        expect(host.registry.get(templateFolderAtom)).toBe("other-templates"),
      ),
    );
    expect(host.registry.get(defaultBindingsAtom)).toBe(before);
    expect(values).toEqual([before]);
    releaseFolder();
    release();
  }),
);

it.effect("reads a note's Profile again when its metadata changes", () =>
  Effect.gen(function* () {
    const file = Object.assign(new TFile(), { path: "notes/paper.md" });
    const events = yield* SubscriptionRef.make<MetadataEvent>({
      _tag: "resolved",
    });
    const profileOf = vi.fn<
      NonNullable<WorkbenchHostDeps["profile"]>["profileOf"]
    >(() =>
      Effect.succeed({ ok: false, stamped: { stamp: "old", id: undefined } }),
    );
    const host = makeWorkbenchHost(
      {
        profile: stubService<NonNullable<WorkbenchHostDeps["profile"]>>(
          "Profile",
          { profileOf },
        ),
        app: stubService<NonNullable<WorkbenchHostDeps["app"]>>("App", {
          vault: stubService<App["vault"]>("Vault", {
            getFileByPath: () => file,
          }),
        }),
      },
      { metadata: SubscriptionRef.changes(events) },
    );
    const atom = fileProfileAtom(file.path);
    const release = host.registry.mount(atom);
    yield* Effect.promise(() =>
      waitFor(() =>
        expect(AsyncResult.isSuccess(host.registry.get(atom))).toBe(true),
      ),
    );
    const count = profileOf.mock.calls.length;
    yield* SubscriptionRef.set(events, {
      _tag: "changed",
      file,
      data: "",
      cache: {},
    });
    yield* Effect.promise(() =>
      waitFor(() => expect(profileOf).toHaveBeenCalledTimes(count + 1)),
    );
    release();
  }),
);
