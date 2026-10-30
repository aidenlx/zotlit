// An Obsidian environment a test sets: desktop by default, or mobile.
import { Effect, Layer } from "effect";
import { ObsidianEnv } from "@/lib/obsidian-env";
import type { ObsidianPlatform } from "@/lib/obsidian-env";

export interface TestObsidianEnvOptions {
  readonly mobile?: boolean;
  /** Flags to set over the desktop or mobile defaults, such as `isMacOS`. */
  readonly platform?: Partial<ObsidianPlatform>;
  readonly apiVersion?: string;
  readonly language?: string;
  readonly vaultName?: string;
  readonly basePath?: string;
  readonly appId?: string;
  /**
   * The ids of the enabled core plugins; none by default. A test that turns
   * one on or off later passes a Set and changes it.
   */
  readonly corePlugins?: ReadonlySet<string>;
}

/** The environment of a desktop app (or a phone app with `mobile`) on a neutral OS. */
export function testObsidianEnv(
  options: TestObsidianEnvOptions = {},
): ObsidianEnv["Service"] {
  const mobile = options.mobile ?? false;
  return ObsidianEnv.of({
    platform: {
      isDesktop: !mobile,
      isMobile: mobile,
      isDesktopApp: !mobile,
      isMobileApp: mobile,
      isIosApp: false,
      isAndroidApp: mobile,
      isPhone: mobile,
      isTablet: false,
      isMacOS: false,
      isWin: false,
      isLinux: !mobile,
      isSafari: false,
      resourcePathPrefix: mobile ? "file:///" : "app://test/",
      ...options.platform,
    },
    apiVersion: options.apiVersion ?? "1.0.0-test",
    language: options.language ?? "en",
    vaultName: options.vaultName ?? "Vault",
    basePath: options.basePath ?? "/vault",
    appId: options.appId ?? "test-app-id",
    corePluginEnabled: (id) =>
      Effect.sync(() => options.corePlugins?.has(id) ?? false),
  });
}

export function layerTestObsidianEnv(
  options?: TestObsidianEnvOptions,
): Layer.Layer<ObsidianEnv> {
  return Layer.succeed(ObsidianEnv, testObsidianEnv(options));
}
