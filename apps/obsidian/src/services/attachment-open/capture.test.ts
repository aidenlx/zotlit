import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import type { Settings } from "@/services/settings/schema";

import { FILES, openerHarness } from "./__fixtures__";
import {
  EXTERNAL_TARGET,
  paneFromTarget,
  registerFileLinkCapture,
} from "./capture";

describe("paneFromTarget", () => {
  // The pane names pass through, which `registerFileLinkCapture` proves with
  // `split`. What is not obvious is that every other target Obsidian sends —
  // reading view's `""`, Live Preview's absent one, Properties' `_blank` — all
  // mean the current pane.
  it.each([[""], [undefined], ["_blank"]])(
    "reads %s as the current pane",
    (target) => {
      expect(paneFromTarget(target)).toBe(false);
    },
  );
});

const PDF_LINK = `file://${FILES.rougier}#page=7`;
const DURABLE =
  "zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2&page=2";

/**
 * Capture installed over a window stand-in whose original `open` records
 * every call, with the real opener behind it: the opener reaches Zotero
 * through the patched `open` with {@link EXTERNAL_TARGET}, as
 * `openWithSystem` does. `open` reads `target.open` at each call, so a
 * disposed registration is observed rather than the wrapper the install
 * returned.
 */
async function host(
  stack: AsyncDisposableStack,
  {
    enabled = true,
    missing = [],
  }: { enabled?: boolean; missing?: readonly string[] } = {},
) {
  const native = vi.fn((..._args: Parameters<Window["open"]>) => null);
  const target = { open: native } as unknown as Window;
  const { opener, service, opened, bridge } = await openerHarness(stack, {
    missing,
    native: (url) => void target.open(url, EXTERNAL_TARGET),
  });
  const registration = registerFileLinkCapture({
    opener,
    attachments: service,
    settings: {
      current: Effect.succeed({
        "reader.open-file-links": enabled,
      } as Settings),
    },
    bridge,
    window: target,
  });
  let installed = true;
  const dispose = () => {
    if (!installed) return;
    installed = false;
    registration[Symbol.dispose]();
  };
  stack.defer(dispose);
  return {
    native,
    opened,
    open: (...args: Parameters<Window["open"]>) => target.open(...args),
    dispose,
  };
}

describe("registerFileLinkCapture", () => {
  it("sends a link the opener takes to Obsidian's reader, in the pane the click asked for", async () => {
    await using stack = new AsyncDisposableStack();
    const capture = await host(stack);

    expect(capture.open(PDF_LINK, "split")).toBeNull();

    await vi.waitFor(() => expect(capture.opened).toHaveLength(1));
    expect(capture.opened[0]).toMatchObject({
      attachment: { indexedKey: "RGRPDF24", subpath: "#page=7" },
      pane: "split",
    });
    expect(capture.native).not.toHaveBeenCalled();
  });

  it("hands a link the opener leaves back to the original as it was called", async () => {
    await using stack = new AsyncDisposableStack();
    const capture = await host(stack);

    capture.open("https://example.com/paper.pdf", "tab", "features");

    expect(capture.native.mock.calls).toEqual([
      ["https://example.com/paper.pdf", "tab", "features"],
    ]);
  });

  it("hands Obsidian's own open-in-default-app target straight back", async () => {
    await using stack = new AsyncDisposableStack();
    const capture = await host(stack);

    capture.open(PDF_LINK, EXTERNAL_TARGET);
    capture.open(DURABLE, EXTERNAL_TARGET);

    expect(capture.native.mock.calls).toEqual([
      [PDF_LINK, EXTERNAL_TARGET, undefined],
      [DURABLE, EXTERNAL_TARGET, undefined],
    ]);
    expect(capture.opened).toEqual([]);
  });

  it("hands every link back while the setting is off", async () => {
    await using stack = new AsyncDisposableStack();
    const capture = await host(stack, { enabled: false });

    capture.open(PDF_LINK, "");
    capture.open(DURABLE, "");

    expect(capture.native.mock.calls).toEqual([
      [PDF_LINK, "", undefined],
      [DURABLE, "", undefined],
    ]);
    expect(capture.opened).toEqual([]);
  });

  // The opener hands Zotero a link through the system handler, which is
  // `window.open` again: the link must pass this patch once, not loop. A
  // Durable Annotation Link whose PDF this computer lacks takes that path.
  it("lets a link the opener hands to Zotero pass the patch once", async () => {
    await using stack = new AsyncDisposableStack();
    const capture = await host(stack, { missing: [FILES.rougier] });

    expect(capture.open(DURABLE, "")).toBeNull();

    await vi.waitFor(() => expect(capture.native).toHaveBeenCalled());
    expect(capture.native.mock.calls).toEqual([
      [DURABLE, EXTERNAL_TARGET, undefined],
    ]);
    expect(capture.opened).toEqual([]);
  });

  it("restores the original open when disposed", async () => {
    await using stack = new AsyncDisposableStack();
    const capture = await host(stack);
    capture.dispose();

    capture.open(PDF_LINK, "");

    expect(capture.native.mock.calls).toEqual([[PDF_LINK, ""]]);
    expect(capture.opened).toEqual([]);
  });
});
