import { describe, expect, it, vi } from "vitest";

import type { AttachmentReader } from "@/lib/attachment-open";
import type {
  AttachmentLookup,
  AttachmentResolution,
} from "@/services/attachment-resolver/service";
import type { Settings } from "@/services/settings/schema";

import {
  decideFileLinkCapture,
  paneFromTarget,
  registerFileLinkCapture,
} from "./capture";
import type { ObsidianOpenableAttachment } from "./resolve";

const VAULT = "/Users/me/Vault";

const RESOLVED_PDF: AttachmentResolution = {
  kind: "resolved",
  serverID: null,
  attachmentKey: "PDFSTR22",
  itemKey: "SAKIMA22",
  openable: true,
};

const RESOLVED_EPUB: AttachmentResolution = {
  kind: "resolved",
  serverID: null,
  attachmentKey: "EPUBSTR2",
  itemKey: "SAKIMA22",
  openable: false,
};

/** Where the Fixture's Rougier PDF sits: a linked file inside the vault. */
const ROUGIER_PATH = "/Users/me/Vault/attachments/rougier-2014.pdf";

const RESOLVED_ROUGIER: AttachmentResolution = {
  kind: "resolved",
  serverID: null,
  attachmentKey: "RGRPDF24",
  itemKey: "RUGIER24",
  openable: true,
};

const ROUGIER_BY_KEY: AttachmentLookup = {
  ...RESOLVED_ROUGIER,
  kind: "resolved",
  absolutePath: ROUGIER_PATH,
};

function context(
  resolution: AttachmentResolution,
  {
    vaultBasePath = VAULT,
    byKey = { kind: "unresolved" },
  }: {
    vaultBasePath?: string;
    byKey?: AttachmentLookup;
  } = {},
) {
  const asked: string[] = [];
  const located: string[] = [];
  return {
    asked,
    located,
    ctx: {
      resolve: (path: string) => {
        asked.push(path);
        return resolution;
      },
      lookup: (key: string) => {
        located.push(key);
        return byKey;
      },
      vaultBasePath,
      platform: "darwin" as NodeJS.Platform,
    },
  };
}

/** A durable link's context: the Rougier PDF known by its key. */
function durable(options: { byKey?: AttachmentLookup } = {}) {
  return context(RESOLVED_ROUGIER, {
    byKey: options.byKey ?? ROUGIER_BY_KEY,
  });
}

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

describe("decideFileLinkCapture", () => {
  it("leaves a web link alone without asking the resolver", () => {
    const { asked, ctx } = context(RESOLVED_PDF);
    expect(decideFileLinkCapture("https://example.com/a.pdf", ctx)).toEqual({
      kind: "pass",
    });
    expect(asked).toEqual([]);
  });

  it("leaves a string that is no URL alone", () => {
    const { ctx } = context(RESOLVED_PDF);
    expect(decideFileLinkCapture("not a url", ctx)).toEqual({ kind: "pass" });
  });

  it("captures a Zotero-managed PDF outside the vault by its file: path", () => {
    const { asked, ctx } = context(RESOLVED_PDF);
    expect(
      decideFileLinkCapture(
        "file:///Users/me/Zotero/storage/ABCD1234/paper.pdf",
        ctx,
      ),
    ).toEqual({
      kind: "capture",
      attachment: {
        indexedKey: "PDFSTR22",
        label: "paper.pdf",
        openPath: "file:/Users/me/Zotero/storage/ABCD1234/paper.pdf",
        absolutePath: "/Users/me/Zotero/storage/ABCD1234/paper.pdf",
      },
    });
    expect(asked).toEqual(["/Users/me/Zotero/storage/ABCD1234/paper.pdf"]);
  });

  it("captures a Zotero-managed PDF inside the vault by its vault-relative path", () => {
    const { ctx } = context(RESOLVED_PDF);
    expect(
      decideFileLinkCapture("file:///Users/me/Vault/papers/paper.pdf", ctx),
    ).toMatchObject({
      kind: "capture",
      attachment: { openPath: "papers/paper.pdf" },
    });
  });

  it("carries the page anchor through as the subpath", () => {
    const { ctx } = context(RESOLVED_PDF);
    expect(
      decideFileLinkCapture(
        "file:///Users/me/Zotero/storage/ABCD1234/paper.pdf#page=7",
        ctx,
      ),
    ).toMatchObject({ attachment: { subpath: "#page=7" } });
  });

  it("decodes a percent-encoded path before it asks the resolver", () => {
    const { asked, ctx } = context(RESOLVED_PDF);
    decideFileLinkCapture(
      "file:///Users/me/Zotero/storage/ABCD1234/Doe%202024.pdf",
      ctx,
    );
    expect(asked).toEqual(["/Users/me/Zotero/storage/ABCD1234/Doe 2024.pdf"]);
  });

  // Which Attachments qualify is `isPdfAttachment`'s rule, proved over real
  // rows in `resolve.test.ts`; what this proves is that Capture obeys the
  // verdict the resolver already reached.
  it("leaves an Attachment the resolver called unopenable alone", () => {
    const { ctx } = context(RESOLVED_EPUB);
    expect(
      decideFileLinkCapture(
        "file:///Users/me/Zotero/storage/E1/book.epub",
        ctx,
      ),
    ).toEqual({ kind: "pass" });
  });

  it("leaves a file Zotero does not know alone", () => {
    const { ctx } = context({ kind: "unresolved" });
    expect(
      decideFileLinkCapture("file:///Users/me/Desktop/scan.pdf", ctx),
    ).toEqual({ kind: "pass" });
  });

  it("leaves the link alone while the resolver cannot answer yet", () => {
    const { ctx } = context({ kind: "pending" });
    expect(
      decideFileLinkCapture(
        "file:///Users/me/Zotero/storage/ABCD1234/paper.pdf",
        ctx,
      ),
    ).toEqual({ kind: "pass" });
  });
});

/** The Durable Annotation Link a Zotero child note carries for one highlight. */
const DURABLE =
  "zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2&page=2";

describe("decideFileLinkCapture, for a Durable Annotation Link", () => {
  it("opens the PDF this computer holds at the Annotation the link names", () => {
    const { asked, located, ctx } = durable();
    expect(decideFileLinkCapture(DURABLE, ctx)).toEqual({
      kind: "capture",
      attachment: {
        indexedKey: "RGRPDF24",
        label: "rougier-2014.pdf",
        openPath: "attachments/rougier-2014.pdf",
        absolutePath: ROUGIER_PATH,
        subpath: "#page=2&zt-annotation=FDRFQ7C2",
      },
      passWhenMissing: true,
    });
    expect(located).toEqual(["RGRPDF24"]);
    expect(asked).toEqual([]);
  });

  // The fragment carries no library segment of its own, so both keys travel as
  // Indexed Keys — the form an Annotation Record's key already takes.
  it("names a group-library Attachment and Annotation by their Indexed Keys", () => {
    const { located, ctx } = durable({
      byKey: { ...ROUGIER_BY_KEY, attachmentKey: "RGRGRUP9g4200309" },
    });
    expect(
      decideFileLinkCapture(
        "zotero://open/groups/4200309/items/RGRGRUP9?annotation=FDRFQ7C2&page=2",
        ctx,
      ),
    ).toMatchObject({
      kind: "capture",
      attachment: { subpath: "#page=2&zt-annotation=FDRFQ7C2g4200309" },
    });
    expect(located).toEqual(["RGRGRUP9g4200309"]);
  });

  // `page` is a printed label. Only a label that reads as a page number can
  // stand in for Obsidian's own jump; the Annotation's own page wins anyway.
  it("leaves out a page label that is no page number", () => {
    const { ctx } = durable();
    expect(
      decideFileLinkCapture(
        "zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2&page=iv",
        ctx,
      ),
    ).toMatchObject({ attachment: { subpath: "#zt-annotation=FDRFQ7C2" } });
  });

  it("leaves a link whose Attachment Zotero does not hold to Zotero", () => {
    const { ctx } = durable({ byKey: { kind: "unresolved" } });
    expect(decideFileLinkCapture(DURABLE, ctx)).toEqual({ kind: "pass" });
  });

  it("leaves the link to Zotero while the resolver cannot answer yet", () => {
    const { ctx } = durable({ byKey: { kind: "pending" } });
    expect(decideFileLinkCapture(DURABLE, ctx)).toEqual({ kind: "pass" });
  });

  // Two Attachments name one file, and the path stands for the other one.
  // The open names the Attachment the link names, and the reader binds that.
  it("opens the Attachment the link names where its file stands for another", () => {
    const { ctx } = context(
      { ...RESOLVED_ROUGIER, attachmentKey: "RGRCOPY1" },
      { byKey: ROUGIER_BY_KEY },
    );
    expect(decideFileLinkCapture(DURABLE, ctx)).toMatchObject({
      kind: "capture",
      attachment: { indexedKey: "RGRPDF24" },
    });
  });

  it("leaves a link to an Attachment Obsidian cannot host to Zotero", () => {
    const { ctx } = durable({
      byKey: { ...ROUGIER_BY_KEY, ...RESOLVED_EPUB, kind: "resolved" },
    });
    expect(decideFileLinkCapture(DURABLE, ctx)).toEqual({ kind: "pass" });
  });

  it.each([
    ["names no annotation", "zotero://open/library/items/RGRPDF24"],
    [
      "carries a malformed annotation key",
      "zotero://open/library/items/RGRPDF24?annotation=FDRF",
    ],
    [
      "selects rather than opens",
      "zotero://select/library/items/RGRPDF24?annotation=FDRFQ7C2",
    ],
  ])("leaves a link that %s alone without asking", (_, url) => {
    const { located, ctx } = durable();
    expect(decideFileLinkCapture(url, ctx)).toEqual({ kind: "pass" });
    expect(located).toEqual([]);
  });
});

const ZOTERO_PDF = "file:///Users/me/Zotero/storage/ABCD1234/paper.pdf";

/**
 * A window stand-in whose `open` records what the original was asked for.
 * `open` reads `target.open` at each call, so a disposed registration is
 * observed rather than the wrapper the install returned.
 */
function host(
  resolution: AttachmentResolution,
  {
    enabled = true,
    byKey = { kind: "unresolved" },
    missing = false,
  }: {
    enabled?: boolean;
    byKey?: AttachmentLookup;
    /** The reader finds no file at the open, as on a computer without the PDF. */
    missing?: boolean;
  } = {},
) {
  const native = vi.fn(() => null);
  let warmed = 0;
  const opened: {
    attachment: ObsidianOpenableAttachment;
    pane: unknown;
  }[] = [];
  const reader: AttachmentReader<ObsidianOpenableAttachment> = {
    icon: "file-text",
    open: (attachment, pane, options) => {
      if (missing) options?.onMissing?.();
      else opened.push({ attachment, pane });
    },
  };
  const target = { open: native } as unknown as Window;
  const registration = registerFileLinkCapture({
    vaultBasePath: VAULT,
    attachments: {
      resolve: () => resolution,
      lookup: () => byKey,
      warm: () => void warmed++,
    },
    settings: { current: { "reader.open-file-links": enabled } as Settings },
    reader,
    window: target,
  });
  return {
    native,
    opened,
    get warmed() {
      return warmed;
    },
    open: (...args: Parameters<Window["open"]>) => target.open(...args),
    [Symbol.dispose]: registration[Symbol.dispose].bind(registration),
  };
}

describe("registerFileLinkCapture", () => {
  it("sends a Zotero-managed PDF to the reader instead of the original", () => {
    using capture = host(RESOLVED_PDF);

    expect(capture.open(`${ZOTERO_PDF}#page=7`, "split")).toBeNull();

    expect(capture.native).not.toHaveBeenCalled();
    expect(capture.opened).toEqual([
      {
        attachment: {
          indexedKey: "PDFSTR22",
          label: "paper.pdf",
          openPath: "file:/Users/me/Zotero/storage/ABCD1234/paper.pdf",
          absolutePath: "/Users/me/Zotero/storage/ABCD1234/paper.pdf",
          subpath: "#page=7",
        },
        pane: "split",
      },
    ]);
  });

  it("hands Obsidian's own open-in-default-app target straight back", () => {
    using capture = host(RESOLVED_PDF);

    capture.open(ZOTERO_PDF, "_external");

    expect(capture.native).toHaveBeenCalledWith(
      ZOTERO_PDF,
      "_external",
      undefined,
    );
    expect(capture.opened).toEqual([]);
  });

  it("hands every link back while the setting is off", () => {
    using capture = host(RESOLVED_PDF, { enabled: false });

    capture.open(ZOTERO_PDF, "");

    expect(capture.native).toHaveBeenCalledWith(ZOTERO_PDF, "", undefined);
    expect(capture.opened).toEqual([]);
  });

  it("leaves a zotero:// link ZotLit opens itself alone", () => {
    using capture = host(RESOLVED_PDF);

    capture.open("zotero://open/library/items/ABCD1234");

    expect(capture.native).toHaveBeenCalled();
    expect(capture.opened).toEqual([]);
  });

  // A note's links are clicked before any PDF is open, and a resolver still
  // building its index answers `pending`, which hands the click to Zotero.
  it("asks the resolver for its index as it installs", () => {
    using capture = host(RESOLVED_ROUGIER);

    expect(capture.warmed).toBe(1);
  });

  it("sends a Durable Annotation Link to the reader at its Annotation", () => {
    using capture = host(RESOLVED_ROUGIER, { byKey: ROUGIER_BY_KEY });

    expect(capture.open(DURABLE, "")).toBeNull();

    expect(capture.native).not.toHaveBeenCalled();
    expect(capture.opened).toEqual([
      {
        attachment: {
          indexedKey: "RGRPDF24",
          label: "rougier-2014.pdf",
          openPath: "attachments/rougier-2014.pdf",
          absolutePath: ROUGIER_PATH,
          subpath: "#page=2&zt-annotation=FDRFQ7C2",
        },
        pane: false,
      },
    ]);
  });

  // A synced library on a second computer names a file that never arrived.
  // The reader finds it missing at the open, and that computer reaches the
  // passage through Zotero instead of a missing-file notice.
  it("hands a Durable Annotation Link to Zotero when the reader finds no file", () => {
    using capture = host(RESOLVED_ROUGIER, {
      byKey: ROUGIER_BY_KEY,
      missing: true,
    });

    expect(capture.open(DURABLE, "tab", "features")).toBeNull();

    expect(capture.native).toHaveBeenCalledWith(DURABLE, "tab", "features");
    expect(capture.opened).toEqual([]);
  });

  // An Attachment File Link names nothing Zotero can open in its stead, so
  // the reader's own missing-file notice answers it, as before.
  it("leaves a missing file behind an Attachment File Link to the reader", () => {
    using capture = host(RESOLVED_PDF, { missing: true });

    capture.open(ZOTERO_PDF, "");

    expect(capture.native).not.toHaveBeenCalled();
  });

  it("hands a Durable Annotation Link back to Zotero for Obsidian's open-in-default-app target", () => {
    using capture = host(RESOLVED_ROUGIER, { byKey: ROUGIER_BY_KEY });

    capture.open(DURABLE, "_external");

    expect(capture.native).toHaveBeenCalledWith(
      DURABLE,
      "_external",
      undefined,
    );
    expect(capture.opened).toEqual([]);
  });

  it("hands a Durable Annotation Link back to Zotero while the setting is off", () => {
    using capture = host(RESOLVED_ROUGIER, {
      enabled: false,
      byKey: ROUGIER_BY_KEY,
    });

    capture.open(DURABLE, "");

    expect(capture.native).toHaveBeenCalledWith(DURABLE, "", undefined);
    expect(capture.opened).toEqual([]);
  });

  it("restores the original open when disposed", () => {
    const capture = host(RESOLVED_PDF);
    capture[Symbol.dispose]();

    capture.open(ZOTERO_PDF, "");

    expect(capture.native).toHaveBeenCalledWith(ZOTERO_PDF, "");
  });
});
