import { resetSync } from "@logtape/logtape";
import { afterEach, describe, expect, it } from "vitest";

import { configureLogTape, enableStartupLogging } from "./log";

afterEach(() => resetSync());

// An `exit` listener on the host process outlives the plugin and holds its
// whole bundle in memory after a disable (#1882).
describe("configuring LogTape for the plugin", () => {
  it("leaves no exit listener on the host process at startup", () => {
    const before = process.listenerCount("exit");
    enableStartupLogging();
    expect(process.listenerCount("exit")).toBe(before);
  });

  it("leaves no exit listener on the host process on a reconfigure", async () => {
    const before = process.listenerCount("exit");
    enableStartupLogging();
    await configureLogTape({
      reset: true,
      sinks: { none: () => {} },
      loggers: [{ category: ["zotlit"], sinks: ["none"] }],
    });
    expect(process.listenerCount("exit")).toBe(before);
  });
});
