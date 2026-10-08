// Obsidian prints a CLI handler's rejection only when it is a string: it
// prints "Error: <text>". It prints any other rejection, such as an Error or
// an AbortError, as "[object Object]", so the caller cannot read why the
// command failed. ZotLitPlugin.registerCliHandler wraps every zotlit:*
// handler with this, so a handler rejects with an Error as usual.

import type { CliHandler } from "obsidian";

/** `handler`, rejecting with the text of its error. */
export function printableCliHandler(handler: CliHandler): CliHandler {
  return async (params) => {
    try {
      return await handler(params);
    } catch (error) {
      // oxlint-disable-next-line no-throw-literal, typescript/only-throw-error -- Obsidian prints only a string rejection.
      throw rejectionText(error);
    }
  };
}

function rejectionText(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}
