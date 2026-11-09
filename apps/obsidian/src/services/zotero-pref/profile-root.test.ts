import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber, FileSystem } from "effect";
import { mkdirSync, mkdtempDisposableSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, vi } from "vitest";

import { electronAppData } from "./__fixtures__/electron-app-data";
import { zoteroProfilesRoot } from "./profile-root";

vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  homedir: vi.fn(),
}));

function profileEnvironment(platform: NodeJS.Platform, appData: string) {
  using stack = new DisposableStack();
  const { path: home } = stack.use(
    mkdtempDisposableSync(join(tmpdir(), "zotlit-profiles-")),
  );
  vi.mocked(homedir).mockReturnValue(home);
  vi.stubGlobal("process", { ...process, platform });
  stack.defer(() => vi.unstubAllGlobals());
  vi.stubEnv("MOZ_LEGACY_HOME", "");
  stack.defer(() => vi.unstubAllEnvs());
  stack.use(electronAppData(appData));
  const resources = stack.move();
  return { home, [Symbol.dispose]: () => resources.dispose() };
}

// Failure modes: XDG profiles are missed, legacy profiles lose precedence,
// or filesystem I/O blocks the renderer instead of suspending the Effect.
describe("zoteroProfilesRoot", () => {
  for (const { platform, appData, suffix } of [
    { platform: "linux", appData: "/home/me/.config", suffix: "zotero/zotero" },
    { platform: "linux", appData: "/custom-config", suffix: "zotero/zotero" },
    {
      platform: "win32",
      appData: "/redirected/Roaming",
      suffix: "Zotero/Zotero",
    },
    {
      platform: "darwin",
      appData: "/Users/me/Library/Application Support",
      suffix: "Zotero",
    },
  ] as const) {
    it.effect(`resolves ${platform} profiles from ${appData}`, () =>
      Effect.gen(function* () {
        yield* Effect.acquireDisposable(
          Effect.sync(() => profileEnvironment(platform, appData)),
        );
        expect(yield* zoteroProfilesRoot).toBe(join(appData, suffix));
      }).pipe(Effect.provide(NodeFileSystem.layer)),
    );
  }

  it.effect("keeps the legacy Linux layout when both profile roots exist", () =>
    Effect.gen(function* () {
      const appData = yield* Effect.acquireDisposable(
        Effect.sync(() => mkdtempDisposableSync(join(tmpdir(), "zotlit-xdg-"))),
      );
      const environment = yield* Effect.acquireDisposable(
        Effect.sync(() => profileEnvironment("linux", appData.path)),
      );
      mkdirSync(join(environment.home, ".zotero/zotero"), { recursive: true });
      mkdirSync(join(appData.path, "zotero/zotero"), { recursive: true });
      expect(yield* zoteroProfilesRoot).toBe(
        join(environment.home, ".zotero/zotero"),
      );
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect(
    "honors Gecko's forced legacy home without checking the filesystem",
    () =>
      Effect.gen(function* () {
        const environment = yield* Effect.acquireDisposable(
          Effect.sync(() => profileEnvironment("linux", "/custom-config")),
        );
        vi.stubEnv("MOZ_LEGACY_HOME", "1");
        const fs = yield* FileSystem.FileSystem;
        expect(
          yield* zoteroProfilesRoot.pipe(
            Effect.provideService(FileSystem.FileSystem, {
              ...fs,
              exists: () =>
                Effect.die(
                  "Forced legacy selection must not check the filesystem",
                ),
            }),
          ),
        ).toBe(join(environment.home, ".zotero/zotero"));
      }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("suspends while the legacy directory check is pending", () =>
    Effect.gen(function* () {
      yield* Effect.acquireDisposable(
        Effect.sync(() => profileEnvironment("linux", "/custom-config")),
      );
      const started = yield* Deferred.make<void>();
      const exists = yield* Deferred.make<boolean>();
      const fs = yield* FileSystem.FileSystem;
      const fiber = yield* zoteroProfilesRoot.pipe(
        Effect.provideService(FileSystem.FileSystem, {
          ...fs,
          exists: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(exists)),
            ),
        }),
        Effect.forkChild,
      );
      yield* Deferred.await(started);
      yield* Deferred.succeed(exists, false);
      expect(yield* Fiber.join(fiber)).toBe(
        join("/custom-config", "zotero/zotero"),
      );
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
});
