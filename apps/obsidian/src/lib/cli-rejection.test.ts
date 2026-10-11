import { describe, expect, it } from "vitest";

import { handlerCheckedFlags, printableCliHandler } from "./cli-rejection";

describe("printableCliHandler", () => {
  it("passes the answer through unchanged", async () => {
    const handler = printableCliHandler((params) => `answer ${params.id}`);

    await expect(handler({ id: "1" })).resolves.toBe("answer 1");
  });

  it.each<[string, unknown, string]>([
    [
      "an Error",
      new Error("The source is not readable."),
      "The source is not readable.",
    ],
    [
      "an AbortError",
      new DOMException("The query 'a' was cancelled.", "AbortError"),
      "The query 'a' was cancelled.",
    ],
    ["an Error without a message", new TypeError(""), "TypeError"],
    [
      "a string",
      "Missing required parameter: id",
      "Missing required parameter: id",
    ],
    ["another value", 42, "42"],
  ])("rejects %s with its text", async (_kind, reason, text) => {
    const handler = printableCliHandler(async () => {
      throw reason;
    });

    await expect(handler({})).rejects.toBe(text);
  });

  it("rejects a synchronous throw with its text", async () => {
    const handler = printableCliHandler(() => {
      throw new Error("cancelAfterMs 'x' is not a time in milliseconds.");
    });

    await expect(handler({})).rejects.toBe(
      "cancelAfterMs 'x' is not a time in milliseconds.",
    );
  });
});

describe("handlerCheckedFlags", () => {
  it("registers a required flag as optional, with the mark in its description", () => {
    const flags = {
      file: { value: "<path>", description: "Note path", required: true },
      format: { value: "<json>", description: "Output format" },
    };

    expect(handlerCheckedFlags(flags)).toEqual({
      file: { value: "<path>", description: "Note path (required)" },
      format: { value: "<json>", description: "Output format" },
    });
    expect(flags.file.required).toBe(true);
  });

  it("keeps a command without flags", () => {
    expect(handlerCheckedFlags(null)).toBeNull();
  });
});
