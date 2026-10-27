// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Stream } from "effect";
import type { App } from "obsidian";
import { expect, vi } from "vitest";

import { createObsidianHost } from "@/lib/__fixtures__/obsidian-host";
import { testRuntime } from "@/lib/__fixtures__/runtime";
import { queryClientsOf } from "@/services/query-client/__fixtures__";
import { settingsRuntimeOf } from "@/services/settings/__fixtures__";
import { readsFixture } from "@/services/zotero-reads/__fixtures__";
import { DbUnavailable } from "@/services/zotero-reads/rpc";
import { layerSource } from "@/services/zotero-reads/source";
import { inProcessClient } from "@/services/zotero-reads/test-utils";

import { registerWelcomeView } from "./register";

// #1705: the missing-file condition must survive layer acquisition.
it.effect(
  "acts on the missing database when the welcome view subscribes late",
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
      // Registration reads the open Library Views only to act on a missing
      // database.
      const getLeavesOfType = vi.fn(() => []);
      Object.assign(host.workspace, {
        getLeavesOfType,
        on: () => ({}),
        offref: () => {},
      });
      const callbacks: (() => void)[] = [];
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          for (const callback of callbacks.toReversed()) callback();
        }),
      );
      const queries = yield* queryClientsOf();
      const { settings, bridge } = yield* settingsRuntimeOf({
        plugin: { loadData: async () => null, saveData: async () => {} },
      });
      registerWelcomeView(
        {
          app: host.app as unknown as App,
          addCommand: (command) => command,
          register: (callback) => {
            callbacks.push(callback);
          },
        },
        { runtime: testRuntime(), reads: plain, queries, settings, bridge },
      );
      expect(getLeavesOfType).toHaveBeenCalledOnce();
      expect(plain.dbFileMissing).toBe(true);
      expect(yield* Stream.runHead(service.changes)).toMatchObject({
        value: { dbFileMissing: true },
      });
    }),
);
