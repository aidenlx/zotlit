import { describe, expect, it } from "vitest";

import { parseEvalReply, wrapEvalCode } from "./obsidian-cli.ts";

/** Runs wrapped code the way Obsidian's `eval` command does: global, awaited. */
async function runInApp(code: string): Promise<unknown> {
  const globalEval = eval;
  return await globalEval(wrapEvalCode(code));
}

describe("wrapEvalCode", () => {
  it.each([
    ["an expression", "1+1", 2],
    ["an async IIFE", "(async()=>{return 'done';})()", "done"],
    ["a statement sequence, by its completion value", "const a=1;a+2", 3],
    ["a promise, awaited", "Promise.resolve(7)", 7],
  ])("answers %s as the unwrapped code does", async (_, code, expected) => {
    expect(await runInApp(code)).toBe(expected);
  });

  it("turns a thrown error into a reply that carries its stack", async () => {
    const reply = await runInApp("(async()=>{throw new Error('boom');})()");
    expect(() => parseEvalReply(`=> ${String(reply)}`)).toThrow(
      expect.objectContaining({
        message: expect.stringMatching(/^boom\n\s+at /),
      }),
    );
  });

  it("turns a thrown non-Error into a reply that names the value", async () => {
    const reply = await runInApp("(()=>{throw 'plain';})()");
    expect(() => parseEvalReply(`=> ${String(reply)}`)).toThrow("plain");
  });
});

describe("parseEvalReply", () => {
  it("takes the last `=> ` line, past console output", () => {
    expect(parseEvalReply("plugin loaded\n=> early\nmore\n=> 42")).toBe("42");
  });

  it("takes a reply that is the whole output", () => {
    expect(parseEvalReply("=> true")).toBe("true");
  });

  it("reports output with no reply line", () => {
    expect(() => parseEvalReply("Vault not found.")).toThrow(
      'obsidian reply had no "=> " line: Vault not found.',
    );
  });

  it("puts the thrown message first, then the app's frames", () => {
    const reply = `=> __zotlitEvalError__${JSON.stringify({
      message: "x",
      stack:
        "Error: x\n    at eval (eval at <anonymous> (app://obsidian.md/app.js:1:1), <anonymous>:1:7)",
    })}`;
    expect(() => parseEvalReply(reply)).toThrow(
      expect.objectContaining({
        message:
          "x\n    at eval (eval at <anonymous> (app://obsidian.md/app.js:1:1), <anonymous>:1:7)",
      }),
    );
  });
});
