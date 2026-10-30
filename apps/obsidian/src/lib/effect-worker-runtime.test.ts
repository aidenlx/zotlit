import * as Context from "effect/Context";
import * as Logger from "effect/Logger";
import * as Ref from "effect/Ref";
import { expect, it } from "vitest";

import { makePortLogger } from "./effect-log-port";
import type { LogPortRecord, PortLogLevel } from "./effect-log-port";
import * as WorkerEffect from "./effect-worker-runtime";

// Failure mode: Effect's default minimum level is Info, so the worker dropped
// debug and trace records before the port logger could forward them.
// `effect-vitest` and the ZoteroReads helper add their own level, so only the
// worker runtime's own entry points show the default.
const portLoggerContext = (posted: LogPortRecord[]) =>
  Context.make(
    Logger.CurrentLoggers,
    new Set([
      makePortLogger(
        { postMessage: (record) => void posted.push(record as LogPortRecord) },
        Ref.makeUnsafe<PortLogLevel | null>("trace"),
      ),
    ]),
  );

const logLowLevels = WorkerEffect.gen(function* () {
  yield* WorkerEffect.logTrace("trace record");
  yield* WorkerEffect.logDebug("debug record");
});

it("forwards debug and trace records from the async worker entry point", async () => {
  const posted: LogPortRecord[] = [];
  await WorkerEffect.runPromiseWith(portLoggerContext(posted))(logLowLevels);
  expect(posted.map(({ level, message }) => [level, message])).toEqual([
    ["Trace", "trace record"],
    ["Debug", "debug record"],
  ]);
});

it("forwards debug and trace records from the sync worker entry point", () => {
  const posted: LogPortRecord[] = [];
  WorkerEffect.runSyncWith(portLoggerContext(posted))(logLowLevels);
  expect(posted.map(({ message }) => message)).toEqual([
    "trace record",
    "debug record",
  ]);
});
