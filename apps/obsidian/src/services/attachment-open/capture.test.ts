import { describe, expect, it, vi } from "vitest";

import type { AttachmentReader } from "@/lib/attachment-open";
import type { AttachmentResolution } from "@/services/attachment-resolver/service";
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
  attachmentKey: "PDFSTR22",
  itemKey: "SAKIMA22",
  openable: true,
};

const RESOLVED_EPUB: AttachmentResolution = {
  kind: "resolved",
  attachmentKey: "EPUBSTR2",
  itemKey: "SAKIMA22",
  openable: false,
};

function context(resolution: AttachmentResolution, vaultBasePath = VAULT) {
  const asked: string[] = [];
  return {
    asked,
    ctx: {
      resolve: (path: string) => {
        asked.push(path);
        return resolution;
      },
      vaultBasePath,
      platform: "darwin" as NodeJS.Platform,
    },
  };
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

const ZOTERO_PDF = "file:///Users/me/Zotero/storage/ABCD1234/paper.pdf";

/**
 * A window stand-in whose `open` records what the original was asked for.
 * `open` reads `target.open` at each call, so a disposed registration is
 * observed rather than the wrapper the install returned.
 */
function host(resolution: AttachmentResolution, enabled = true) {
  const native = vi.fn(() => null);
  const opened: {
    attachment: ObsidianOpenableAttachment;
    pane: unknown;
  }[] = [];
  const reader: AttachmentReader<ObsidianOpenableAttachment> = {
    icon: "file-text",
    open: (attachment, pane) => void opened.push({ attachment, pane }),
  };
  const target = { open: native } as unknown as Window;
  const registration = registerFileLinkCapture({
    vaultBasePath: VAULT,
    attachments: { resolve: () => resolution },
    settings: { current: { "reader.open-file-links": enabled } as Settings },
    reader,
    window: target,
  });
  return {
    native,
    opened,
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
    using capture = host(RESOLVED_PDF, false);

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

  it("restores the original open when disposed", () => {
    const capture = host(RESOLVED_PDF);
    capture[Symbol.dispose]();

    capture.open(ZOTERO_PDF, "");

    expect(capture.native).toHaveBeenCalledWith(ZOTERO_PDF, "");
  });
});
