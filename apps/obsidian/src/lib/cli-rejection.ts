// Obsidian prints a CLI handler's rejection only when it is a string: it
// prints "Error: <text>". It prints any other rejection, such as an Error or
// an AbortError, as "[object Object]", so the caller cannot read why the
// command failed. ZotLitPlugin.registerCliHandler wraps every zotlit:*
// handler with this, so a handler rejects with an Error as usual.
//
// Obsidian also answers "Missing required parameter" before it calls a
// handler whose `required` flag the call does not name, so a `--file=` token
// never reaches the decoder that names its `file=<value>` form. The same
// wrapper registers every flag as optional and carries the mark in the
// description, as Obsidian's help prints it.

import type { CliFlags, CliHandler } from "obsidian";

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

/** `flags`, with each required mark moved into its description. */
export function handlerCheckedFlags(flags: CliFlags | null): CliFlags | null {
  if (flags === null) return null;
  return Object.fromEntries(
    Object.entries(flags).map(([name, { required, ...flag }]) => [
      name,
      required
        ? { ...flag, description: `${flag.description} (required)` }
        : flag,
    ]),
  );
}

function rejectionText(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}
