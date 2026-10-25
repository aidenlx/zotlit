import { it } from "@effect/vitest";
import { resetMockPlatform, setMockPlatform } from "@mock/obsidian";
import { Effect, Layer } from "effect";
import type { App, FileSystemAdapter, Vault } from "obsidian";
import { afterEach, describe, expect } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { ObsidianApp } from "@/lib/obsidian-app";

import { layerTestObsidianEnv } from "./__fixtures__/obsidian-env";
import { layerObsidianEnv, ObsidianEnv } from "./obsidian-env";

afterEach(() => {
  resetMockPlatform();
});

describe("layerObsidianEnv", () => {
  it.effect("reads the platform, version, language and vault folder once", () =>
    Effect.gen(function* () {
      setMockPlatform({ isMacOS: true, isWin: false, isDesktopApp: true });
      let reads = 0;
      const app = stubService<App>("App", {
        vault: stubService<Vault>("Vault", {
          adapter: stubService<FileSystemAdapter>("FileSystemAdapter", {
            getBasePath: () => {
              reads += 1;
              return "/Users/me/vault";
            },
          }),
        }),
      });
      const env = yield* ObsidianEnv.pipe(
        Effect.provide(
          layerObsidianEnv.pipe(Layer.provide(Layer.succeed(ObsidianApp, app))),
        ),
      );

      expect(env).toMatchObject({
        platform: { isMacOS: true, isWin: false, isDesktopApp: true },
        apiVersion: "1.0.0-test",
        language: "en",
        basePath: "/Users/me/vault",
      });
      // The mock flags are reset: a later read of the env must not reach them.
      resetMockPlatform();
      expect(env.platform.isMacOS).toBe(true);
      expect(env.basePath).toBe("/Users/me/vault");
      expect(reads).toBe(1);
    }),
  );
});

describe("layerTestObsidianEnv", () => {
  it.effect("is a desktop app unless the test sets mobile", () =>
    Effect.gen(function* () {
      const desktop = yield* ObsidianEnv.pipe(
        Effect.provide(layerTestObsidianEnv()),
      );
      const mobile = yield* ObsidianEnv.pipe(
        Effect.provide(layerTestObsidianEnv({ mobile: true })),
      );

      expect(desktop.platform).toMatchObject({
        isDesktopApp: true,
        isMobileApp: false,
      });
      expect(mobile.platform).toMatchObject({
        isDesktopApp: false,
        isMobile: true,
        isMobileApp: true,
      });
    }),
  );
});
