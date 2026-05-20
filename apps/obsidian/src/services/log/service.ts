/**
 * `LoggingService` — owns `configure()` and the optional vault file sink.
 *
 * The service subscribes to `SettingsService` (which fires synchronously with
 * the current value on registration), and the first synchronous fire drives
 * the initial `configure()` call. Later subscriber fires re-apply the new
 * `(level, toFile)` pair via a bail-if-same + tail-loop reconfigure so rapid
 * setting flips coalesce into one final configure with a single open sink.
 *
 * The file sink is a moving target — replaced on every reconfigure — so it is
 * held in `#currentSink` and disposed via `stack.defer` rather than
 * `stack.use`. When `log.level` is `null`, the `["zotlit"]` category routes
 * to no sinks and no file is opened, regardless of `log.to-file`.
 *
 * **Disposal ordering** (LIFO across the three `stack.defer` calls):
 * 1. `unsubscribe()` — stop new reconfigures from being queued.
 * 2. `await #loopPromise` — let any in-flight `#applyConfig` settle so
 *    `#currentSink` reaches a stable state before we touch it.
 * 3. `#disposeCurrentSink()` + LogTape `reset()` — release the file sink
 *    and drop the global configuration.
 */

import {
  type LogLevel,
  type Sink,
  configure,
  getConsoleSink,
  reset as resetLogtape,
} from "@logtape/logtape";
import type { Plugin } from "obsidian";

import { devToolsFormatter } from "@zotlit/shared/log-formatter";
import { Service } from "@/services/service-base";
import type { Settings, SettingsService } from "@/services/settings/service";
import { createVaultFileSink } from "./vault-sink";

export const LOG_FILENAME = "zotlit.log.jsonl";

export interface LoggingServiceOptions {
  plugin: Pick<Plugin, "app" | "manifest">;
  settings: SettingsService;
}

interface AppliedConfig {
  level: LogLevel | null;
  toFile: boolean;
}

const INITIAL_APPLIED: AppliedConfig = { level: "info", toFile: false };

export class LoggingService extends Service<void> {
  readonly #plugin;
  readonly #settings;

  #desired: AppliedConfig = INITIAL_APPLIED;
  #applied: AppliedConfig | null = null;
  #running = false;
  #loopPromise: Promise<void> = Promise.resolve();
  #currentSink: (Sink & AsyncDisposable) | null = null;

  ready: Promise<void>;

  constructor(options: LoggingServiceOptions) {
    super();
    this.#plugin = options.plugin;
    this.#settings = options.settings;
    this.ready = this.#load();
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();

    // LIFO order: unsubscribe → wait-for-in-flight → release-resources.
    stack.defer(async () => {
      await this.#disposeCurrentSink();
      try {
        await resetLogtape();
      } catch (error) {
        console.error("Failed to reset LogTape on dispose", error);
      }
    });
    stack.defer(async () => {
      await this.#loopPromise.catch(() => undefined);
    });

    await this.#settings.ready;

    let firstFlush: Promise<void> | undefined;
    stack.defer(
      this.#settings.subscribe((value) => {
        if (value === null) return;
        this.#desired = settingsToConfig(value);
        const promise = this.#flushDesired();
        if (firstFlush === undefined) {
          // The initial subscribe-fire is awaited by `#load()` below, so its
          // rejection surfaces through `ready`.
          firstFlush = promise;
        } else {
          // Background reconfigures aren't awaited; surface their failures
          // ourselves so they don't become unhandled rejections.
          promise.catch((error: unknown) => {
            console.error("LoggingService reconfigure failed", error);
          });
        }
      }),
    );

    if (firstFlush) await firstFlush;

    this.commit(stack.move());
  }

  /**
   * Bail-if-same + tail-loop. While a reconfigure is in flight, additional
   * calls only bump `#desired`; the running loop re-checks `#desired` between
   * iterations so the latest state wins.
   *
   * @returns the active loop's promise so callers (and dispose) can await it.
   */
  #flushDesired(): Promise<void> {
    if (this.#running) return this.#loopPromise;
    this.#running = true;
    this.#loopPromise = (async () => {
      try {
        while (!sameConfig(this.#applied, this.#desired)) {
          const next = this.#desired;
          await this.#applyConfig(next);
          this.#applied = next;
        }
      } finally {
        this.#running = false;
      }
    })();
    return this.#loopPromise;
  }

  async #applyConfig(next: AppliedConfig): Promise<void> {
    await this.#disposeCurrentSink();

    const fileEnabled = next.level !== null && next.toFile;
    const sinks: Record<string, Sink> = {
      console: getConsoleSink({ formatter: devToolsFormatter }),
    };
    if (fileEnabled) {
      const path = `${this.#plugin.manifest.dir}/${LOG_FILENAME}`;
      const file = await createVaultFileSink(
        this.#plugin.app.vault.adapter,
        path,
      );
      this.#currentSink = file;
      sinks.file = file;
    }

    const zotlitSinks: string[] =
      next.level === null
        ? []
        : fileEnabled
          ? ["console", "file"]
          : ["console"];

    await configure({
      reset: true,
      sinks,
      loggers: [
        {
          category: ["zotlit"],
          sinks: zotlitSinks,
          lowestLevel: next.level ?? "fatal",
        },
        {
          category: ["logtape", "meta"],
          sinks: fileEnabled ? ["console", "file"] : ["console"],
          lowestLevel: "warning",
        },
      ],
    });
  }

  async #disposeCurrentSink(): Promise<void> {
    const sink = this.#currentSink;
    if (!sink) return;
    this.#currentSink = null;
    await sink[Symbol.asyncDispose]();
  }
}

function settingsToConfig(value: Readonly<Settings>): AppliedConfig {
  return { level: value["log.level"], toFile: value["log.to-file"] };
}

function sameConfig(a: AppliedConfig | null, b: AppliedConfig): boolean {
  return a !== null && a.level === b.level && a.toFile === b.toFile;
}
