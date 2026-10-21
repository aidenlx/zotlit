import { describe, expect, it, vi } from "vitest";

import type { Settings } from "@/services/settings/schema";

import {
  EXTERNAL_TARGET,
  paneFromTarget,
  registerFileLinkCapture,
} from "./capture";
import type { OpenOutcome, TargetOpener } from "./open-target";

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

const PDF_LINK = "file:///Users/me/Zotero/storage/ABCD1234/paper.pdf#page=7";
const DURABLE =
  "zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2&page=2";

/**
 * A window stand-in whose `open` records what the original was asked for,
 * patched over an opener that takes the links in `taken`. `open` reads
 * `target.open` at each call, so a disposed registration is observed rather
 * than the wrapper the install returned.
 */
function host({
  enabled = true,
  taken = [] as readonly string[],
  follow,
}: {
  enabled?: boolean;
  taken?: readonly string[];
  /** Stands in for the opener's own decision, given the patched `open`. */
  follow?: (url: string, open: Window["open"]) => Promise<OpenOutcome> | null;
} = {}) {
  const native = vi.fn(() => null);
  let warmed = 0;
  const followed: { url: string; pane: unknown }[] = [];
  const target = { open: native } as unknown as Window;
  const opener: Pick<TargetOpener, "follow"> = {
    follow(url, pane) {
      followed.push({ url, pane });
      if (follow) return follow(url, target.open.bind(target));
      return taken.includes(url) ? Promise.resolve({ kind: "reader" }) : null;
    },
  };
  const registration = registerFileLinkCapture({
    opener,
    attachments: { warm: () => void warmed++ },
    settings: { current: { "reader.open-file-links": enabled } as Settings },
    window: target,
  });
  return {
    native,
    followed,
    get warmed() {
      return warmed;
    },
    open: (...args: Parameters<Window["open"]>) => target.open(...args),
    [Symbol.dispose]: registration[Symbol.dispose].bind(registration),
  };
}

describe("registerFileLinkCapture", () => {
  it("sends a link the opener takes to it, in the pane the click asked for", () => {
    using capture = host({ taken: [PDF_LINK] });

    expect(capture.open(PDF_LINK, "split")).toBeNull();

    expect(capture.followed).toEqual([{ url: PDF_LINK, pane: "split" }]);
    expect(capture.native).not.toHaveBeenCalled();
  });

  it("hands a link the opener leaves back to the original as it was called", () => {
    using capture = host();

    capture.open(DURABLE, "tab", "features");

    expect(capture.native).toHaveBeenCalledWith(DURABLE, "tab", "features");
  });

  it("hands Obsidian's own open-in-default-app target straight back", () => {
    using capture = host({ taken: [PDF_LINK, DURABLE] });

    capture.open(PDF_LINK, EXTERNAL_TARGET);
    capture.open(DURABLE, EXTERNAL_TARGET);

    expect(capture.followed).toEqual([]);
    expect(capture.native.mock.calls).toEqual([
      [PDF_LINK, EXTERNAL_TARGET, undefined],
      [DURABLE, EXTERNAL_TARGET, undefined],
    ]);
  });

  it("hands every link back while the setting is off", () => {
    using capture = host({ enabled: false, taken: [PDF_LINK, DURABLE] });

    capture.open(PDF_LINK, "");
    capture.open(DURABLE, "");

    expect(capture.followed).toEqual([]);
    expect(capture.native).toHaveBeenCalledTimes(2);
  });

  // The opener hands Zotero a link through the system handler, which is
  // `window.open` again: the link must pass this patch once, not loop.
  it("lets a link the opener hands to Zotero pass the patch once", async () => {
    let handed: Promise<OpenOutcome> | undefined;
    using capture = host({
      follow: (url, open) => {
        if (handed !== undefined) return null;
        handed = Promise.resolve().then(() => {
          open(url, EXTERNAL_TARGET);
          return { kind: "zotero", url } as const;
        });
        return handed;
      },
    });

    capture.open(DURABLE, "");
    await handed;

    expect(capture.followed).toHaveLength(1);
    expect(capture.native.mock.calls).toEqual([
      [DURABLE, EXTERNAL_TARGET, undefined],
    ]);
  });

  // A note's links are clicked before any PDF is open, and the opener leaves
  // every link to the system handler until the index lands.
  it("asks the resolver for its index as it installs", () => {
    using capture = host();

    expect(capture.warmed).toBe(1);
  });

  it("restores the original open when disposed", () => {
    const capture = host({ taken: [PDF_LINK] });
    capture[Symbol.dispose]();

    capture.open(PDF_LINK, "");

    expect(capture.followed).toEqual([]);
    expect(capture.native).toHaveBeenCalledWith(PDF_LINK, "");
  });
});
