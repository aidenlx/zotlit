// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

import { writeClipboardRichText } from "./clipboard";

const payload = {
  html: "<p>Rivers, A. (2020). <i>Field notes</i>. Harbour Press.</p>",
  text: "Rivers, A. (2020). Field notes. Harbour Press.",
};

let write: MockInstance<Clipboard["write"]>;
let writeText: MockInstance<Clipboard["writeText"]>;

/** What the one clipboard item carries, as a paste-time reader would find it. */
async function written(): Promise<Record<string, string>> {
  const [items] = write.mock.calls[0]!;
  const [item] = items as ClipboardItem[];
  const parts = await Promise.all(
    item!.types.map(
      async (type) => [type, await (await item!.getType(type)).text()] as const,
    ),
  );
  return Object.fromEntries(parts);
}

beforeEach(() => {
  write = vi.spyOn(navigator.clipboard, "write").mockResolvedValue();
  writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("writeClipboardRichText", () => {
  it("offers both representations in one write", async () => {
    await expect(writeClipboardRichText(payload)).resolves.toBe("rich");

    expect(write).toHaveBeenCalledOnce();
    expect(writeText).not.toHaveBeenCalled();
    await expect(written()).resolves.toEqual({
      "text/html": payload.html,
      "text/plain": payload.text,
    });
  });

  it("writes the text alone when the platform takes no rich content", async () => {
    write.mockRejectedValue(new Error("write is not a function"));

    await expect(writeClipboardRichText(payload)).resolves.toBe("text");
    expect(writeText).toHaveBeenCalledExactlyOnceWith(payload.text);
  });

  it("reports a clipboard that took neither representation", async () => {
    write.mockRejectedValue(new Error("rich write refused"));
    writeText.mockRejectedValue(new Error("clipboard unavailable"));

    await expect(writeClipboardRichText(payload)).rejects.toThrow(
      "clipboard unavailable",
    );
  });
});
