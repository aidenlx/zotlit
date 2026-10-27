// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Stream } from "effect";
import type { App } from "obsidian";
import { expect } from "vitest";

import { createObsidianHost } from "@/lib/__fixtures__/obsidian-host";
import { testRuntime } from "@/lib/__fixtures__/runtime";
import { readsFixture } from "@/services/zotero-reads/__fixtures__";
import { DbUnavailable } from "@/services/zotero-reads/rpc";
import { layerSource } from "@/services/zotero-reads/source";
import { inProcessClient } from "@/services/zotero-reads/test-utils";

import type { NotFoundSignal } from "./not-found-notice";
import { watchNotFound } from "./register";

// #1705: the missing-file condition must survive layer acquisition.
it.effect(
  "signals the missing database to a welcome view that subscribes late",
  () =>
    Effect.gen(function* () {
      const missing = () =>
        Effect.fail(
          new DbUnavailable({
            message: "ENOENT: database is absent",
          }),
        );
      const { service, plain } = yield* readsFixture(
        inProcessClient(
          layerSource({
            initial: {
              databasePath: "/missing/zotero.sqlite",
              readMode: "copy",
              autoRefresh: false,
              locale: null,
              chineseSegmenter: null,
              logLevel: null,
            },
            ports: {
              snapshotSource: missing,
              prepareRead: missing,
              existsSync: () => false,
              reapReadClones: () => Effect.void,
            },
          }).pipe(Layer.provide(FileSystem.layerNoop({}))),
        ),
      );
      yield* Stream.runHead(
        Stream.filter(service.changes, (state) => state.state === "degraded"),
      );
      const host = createObsidianHost({});
      Object.assign(host.workspace, {
        on: () => ({}),
        offref: () => {},
      });
      const callbacks: (() => void)[] = [];
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          for (const callback of callbacks.toReversed()) callback();
        }),
      );
      const signals: NotFoundSignal[] = [];
      watchNotFound(
        {
          app: host.app as unknown as App,
          register: (callback) => {
            callbacks.push(callback);
          },
        },
        { runtime: testRuntime(), reads: plain },
        (signal) => signals.push(signal),
      );
      expect(signals).toEqual(["db-file-missing"]);
      expect(plain.dbFileMissing).toBe(true);
      expect(yield* Stream.runHead(service.changes)).toMatchObject({
        value: { dbFileMissing: true },
      });
    }),
);
