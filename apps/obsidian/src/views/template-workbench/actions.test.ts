// @vitest-environment happy-dom
import { configureSync, resetSync } from "@logtape/logtape";
import type { LogRecord } from "@logtape/logtape";
import { afterEach, expect, it } from "vitest";

import { AbortError } from "@/lib/abort-error";

import { runTemplateWorkbenchAction } from "./actions";

afterEach(() => resetSync());

// #1819: unpack and restore callbacks already release an aborted action quietly.
it.each(["unpack-partials", "restore-default"])(
  "releases %s without an error log when unload aborts it",
  async (operation) => {
    const records: LogRecord[] = [];
    configureSync({
      reset: true,
      sinks: { capture: (record) => records.push(record) },
      loggers: [
        { category: ["zotlit"], sinks: ["capture"], lowestLevel: "error" },
      ],
    });
    const result = await runTemplateWorkbenchAction(operation, async () => {
      throw new AbortError();
    });
    expect(result).toBe(false);
    expect(records).toEqual([]);
  },
);
