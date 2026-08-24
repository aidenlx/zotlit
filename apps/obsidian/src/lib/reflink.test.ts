import { describe, expect, it } from "vitest";

import { isClonefileUnsupported } from "./reflink";

/** A rejection shaped like the one `promisify(execFile)` raises. */
function execFailure(stderr: string): Error {
  return Object.assign(new Error("Command failed: cp -c -n src dest"), {
    code: 1,
    stdout: "",
    stderr,
  });
}

describe("isClonefileUnsupported", () => {
  it("classifies a clone the volume refused", () => {
    expect(
      isClonefileUnsupported(
        execFailure("cp: clonefile failed: Cross-device link\n"),
      ),
    ).toBe(true);
  });

  it("leaves other exit failures unclassified", () => {
    expect(
      isClonefileUnsupported(
        execFailure("cp: /zotero/zotero.sqlite: No such file or directory\n"),
      ),
    ).toBe(false);
  });

  it("leaves errno-carrying errors unclassified", () => {
    expect(
      isClonefileUnsupported(
        Object.assign(new Error("spawn cp ENOENT"), {
          code: "ENOENT",
          errno: -2,
          syscall: "spawn cp",
        }),
      ),
    ).toBe(false);
  });
});
