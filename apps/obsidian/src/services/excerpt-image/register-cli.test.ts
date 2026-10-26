import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { it } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";
import type { Scope } from "effect";
import { join } from "node:path";
import { describe, expect } from "vitest";

import { openScenarioDatabase } from "@zotlit/db/test-scenario";

import { stubService } from "@/lib/__fixtures__/service-stub";
import type { CliCommand } from "@/lib/cli-command";
import { PluginHost } from "@/lib/plugin-host";
import type { PluginHostShape } from "@/lib/plugin-host";
import { ZoteroPref } from "@/services/zotero-pref/service";
import type { ZoteroPrefSnapshot } from "@/services/zotero-pref/service";
import { layerRcRef } from "@/services/zotero-reads/connection";
import { DbUnavailable } from "@/services/zotero-reads/rpc";
import { layerZoteroReads, ZoteroReads } from "@/services/zotero-reads/service";
import {
  inProcessClient,
  sharedClientOpener,
} from "@/services/zotero-reads/test-utils";

import { ANNOTATION_IMAGE_COMMAND } from "./cli-image";
import { ExcerptImages } from "./layer";
import { layerAnnotationImageCli } from "./register-cli";

/**
 * The command the layer registers, over `reads`, a data directory at
 * `dataDir`, and an Excerpt Image service that resolves nothing.
 */
const registered = (
  reads: Layer.Layer<ZoteroReads>,
  dataDir: string,
): Effect.Effect<CliCommand, never, FileSystem.FileSystem | Scope.Scope> =>
  Effect.gen(function* () {
    const commands = new Map<string, CliCommand>();
    yield* Layer.build(
      layerAnnotationImageCli.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(
              PluginHost,
              stubService<PluginHostShape>("PluginHost", {
                registerCliCommand: (name, command) =>
                  void commands.set(name, command),
              }),
            ),
            reads,
            Layer.mock(ZoteroPref, {
              current: Effect.succeed(
                stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", {
                  dataDir,
                  baseAttachmentPath: null,
                }),
              ),
            }),
            Layer.succeed(
              ExcerptImages,
              stubService<ExcerptImages["Service"]>("ExcerptImages", {
                resolve: () => Promise.resolve({ kind: "unavailable" }),
              }),
            ),
          ),
        ),
      ),
    );
    const command = commands.get(ANNOTATION_IMAGE_COMMAND);
    if (!command) throw new Error("the command was not registered");
    return command;
  });

/** The real ZoteroReads over the annotations scenario database. */
const scenarioReads = Effect.acquireDisposable(
  Effect.sync(() => openScenarioDatabase({ annotations: true })),
).pipe(
  Effect.map((scenario) =>
    layerZoteroReads(
      inProcessClient(layerRcRef(sharedClientOpener(scenario.db))),
    ),
  ),
);

describe("zotlit:annotation-image registration", () => {
  it.effect(
    "answers source-unavailable where the database cannot be read",
    () =>
      Effect.gen(function* () {
        const command = yield* registered(
          Layer.succeed(
            ZoteroReads,
            stubService<ZoteroReads["Service"]>("ZoteroReads", {
              snapshot: Effect.fail(
                new DbUnavailable({ message: "database disk is locked" }),
              ),
            }),
          ),
          "/zotero",
        );

        const answer = JSON.parse(yield* command.handler({ key: "ANN2IMAG" }));

        expect(answer).toMatchObject({
          ok: false,
          diagnostic: {
            code: "source-unavailable",
            message: "database disk is locked",
          },
        });
      }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect(
    "tells a PDF missing on this device from one that would not render",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dataDir = yield* fs.makeTempDirectoryScoped();
        const command = yield* registered(yield* scenarioReads, dataDir);
        const answer = () =>
          command
            .handler({ key: "ANN2IMAG" })
            .pipe(Effect.map((text) => JSON.parse(text) as unknown));

        expect(yield* answer()).toMatchObject({
          diagnostic: { code: "file-unavailable" },
        });

        const pdf = join(dataDir, "storage", "PDF2LIVE", "exact.pdf");
        yield* fs.makeDirectory(join(dataDir, "storage", "PDF2LIVE"), {
          recursive: true,
        });
        yield* fs.writeFileString(pdf, "%PDF-1.7");

        expect(yield* answer()).toMatchObject({
          diagnostic: { code: "render-failed" },
        });
      }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
});
