// Runs a skill-trigger probe against pi in non-interactive JSON mode.
//
// Each probe spawns `pi --mode json --skill <path> -p <query>` and watches the
// JSON event stream for a tool call that reads the skill. pi loads the skill
// through `--skill`, so no command-file shim is needed.

import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";

export interface ProbeOptions {
  /** The query handed to pi. */
  query: string;
  /** The skill directory to expose through `--skill`. */
  skillPath: string;
  /** Working directory for the probe. */
  cwd: string;
  /** Abort the probe after this many milliseconds. */
  timeoutMs: number;
  /** Model pattern passed through to pi. */
  model?: string;
}

export interface ProbeResult {
  triggered: boolean;
  timedOut: boolean;
}

/** Iterate the newline-delimited JSON records of a stream. */
async function* lines(stream: AsyncIterable<Buffer>): AsyncGenerator<string> {
  let buffer = "";
  for await (const chunk of stream) {
    buffer += chunk.toString("utf8");
    let index = buffer.indexOf("\n");
    while (index !== -1) {
      yield buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf("\n");
    }
  }
  if (buffer.trim()) yield buffer;
}

/** True when an event is a tool call touching the skill directory. */
function isSkillToolCall(event: unknown, skillPath: string): boolean {
  const record = event as {
    type?: string;
    toolName?: string;
    args?: { path?: string; file_path?: string };
    message?: {
      content?: {
        type?: string;
        name?: string;
        input?: Record<string, string>;
      }[];
    };
  };

  if (record.type === "toolcall_start") {
    const target = record.args?.path ?? record.args?.file_path ?? "";
    return target.includes(skillPath);
  }

  if (record.type === "message_end" || record.type === "turn_end") {
    const content = record.message?.content ?? [];
    return content.some((item) => {
      if (item.type !== "tool_use") return false;
      const target = item.input?.path ?? item.input?.file_path ?? "";
      return target.includes(skillPath);
    });
  }

  return false;
}

/** Run one probe and report whether pi read the skill. */
export function probeTrigger(options: ProbeOptions): Promise<ProbeResult> {
  return new Promise((resolveProbe) => {
    const args = [
      "--mode",
      "json",
      "--skill",
      options.skillPath,
      "--print",
      ...(options.model ? ["--model", options.model] : []),
      options.query,
    ];

    const child = spawn("pi", args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "ignore"],
    });

    let triggered = false;
    let settled = false;
    const finish = (result: ProbeResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolveProbe(result);
    };

    const timer = setTimeout(
      () => finish({ triggered, timedOut: true }),
      options.timeoutMs,
    );

    void (async () => {
      for await (const line of lines(child.stdout)) {
        if (!line.trim()) continue;
        let event: unknown;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (isSkillToolCall(event, options.skillPath)) {
          triggered = true;
          finish({ triggered: true, timedOut: false });
          return;
        }
      }
      finish({ triggered, timedOut: false });
    })();

    child.on("error", () => finish({ triggered, timedOut: false }));
    child.on("close", () => finish({ triggered, timedOut: false }));
  });
}

export interface TriggerEvalItem {
  query: string;
  should_trigger: boolean;
}

export interface TriggerOutcome {
  query: string;
  should_trigger: boolean;
  trigger_rate: number;
  triggers: number;
  runs: number;
  pass: boolean;
}

export interface TriggerEvalOptions {
  evalSet: TriggerEvalItem[];
  skillPath: string;
  cwd: string;
  timeoutMs: number;
  runsPerQuery: number;
  triggerThreshold: number;
  model?: string;
  concurrency?: number;
  verbose?: boolean;
}

/** Run every item `runsPerQuery` times and score the trigger rate. */
export async function runTriggerEval(
  options: TriggerEvalOptions,
): Promise<TriggerOutcome[]> {
  const limit = options.concurrency ?? Math.max(1, availableParallelism() - 1);
  const probes = options.evalSet.flatMap((item) =>
    Array.from({ length: options.runsPerQuery }, () => item),
  );

  const outcomes: TriggerOutcome[] = options.evalSet.map((item) => ({
    query: item.query,
    should_trigger: item.should_trigger,
    trigger_rate: 0,
    triggers: 0,
    runs: 0,
    pass: false,
  }));
  const indexByQuery = new Map(
    outcomes.map((outcome, index) => [outcome.query, index]),
  );

  const pending = [...probes];
  await Promise.all(
    Array.from({ length: Math.min(limit, pending.length) }, async () => {
      for (let item = pending.pop(); item; item = pending.pop()) {
        const result = await probeTrigger({ ...options, query: item.query });
        const outcome = outcomes[indexByQuery.get(item.query)!]!;
        outcome.triggers += result.triggered ? 1 : 0;
        outcome.runs += 1;
        if (options.verbose) {
          const status = result.triggered ? "fired" : "miss";
          console.error(`[${status}] ${item.query.slice(0, 70)}`);
        }
      }
    }),
  );

  for (const outcome of outcomes) {
    outcome.trigger_rate =
      outcome.runs === 0 ? 0 : outcome.triggers / outcome.runs;
    outcome.pass = outcome.should_trigger
      ? outcome.trigger_rate >= options.triggerThreshold
      : outcome.trigger_rate < options.triggerThreshold;
  }

  return outcomes;
}
