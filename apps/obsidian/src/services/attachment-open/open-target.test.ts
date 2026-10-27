import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

import * as m from "@/lib/i18n/generated/messages";
import { defaults } from "@/services/settings/schema";

import { FILES, openerFixture } from "./__fixtures__";
import type { OpenTarget } from "./open-target";

const ANNOTATION: OpenTarget = {
  kind: "annotation",
  attachmentKey: "RGRPDF24",
  annotationKey: "FDRFQ7C2",
  pageIndex: 1,
  pageLabel: "2",
};

describe("open", () => {
  it.effect(
    "opens an Obsidian-Openable Attachment in Obsidian's reader, in the pane asked for",
    () =>
      Effect.gen(function* () {
        const { opener, opened, handed } = yield* openerFixture();

        expect(
          yield* opener.open(
            { kind: "attachment", attachmentKey: "PDFSTR22" },
            "tab",
          ),
        ).toEqual({ kind: "reader" });

        expect(opened).toEqual([
          {
            attachment: {
              indexedKey: "PDFSTR22",
              label: "sakimas song.pdf",
              openPath: `file:${FILES.stored}`,
              absolutePath: FILES.stored,
            },
            pane: "tab",
          },
        ]);
        expect(handed).toEqual([]);
      }),
  );

  it.effect("opens an Annotation at its page, with its Annotation Anchor", () =>
    Effect.gen(function* () {
      const { opener, opened } = yield* openerFixture();

      yield* opener.open(ANNOTATION, false);

      expect(opened).toEqual([
        {
          attachment: {
            indexedKey: "RGRPDF24",
            label: "rougier-2014.pdf",
            openPath: "attachments/rougier-2014.pdf",
            absolutePath: FILES.rougier,
            subpath: "#page=2&zt-annotation=FDRFQ7C2",
          },
          pane: false,
        },
      ]);
    }),
  );

  // Two Attachments keep one file. The open names the one it was asked for,
  // not the one the path chooses, and the reader binds that one.
  it.effect(
    "opens the Attachment it was asked for where another keeps the same file",
    () =>
      Effect.gen(function* () {
        const { opener, opened, service } = yield* openerFixture();
        expect(yield* service.resolve(FILES.rougier)).toMatchObject({
          attachmentKey: "RGRPDF24",
        });

        yield* opener.open(
          { kind: "attachment", attachmentKey: "RGRCPYB8" },
          false,
        );

        expect(opened.map(({ attachment }) => attachment.indexedKey)).toEqual([
          "RGRCPYB8",
        ]);
      }),
  );

  it.effect("hands an Attachment Obsidian cannot host to Zotero", () =>
    Effect.gen(function* () {
      const { opener, opened, handed } = yield* openerFixture();

      expect(
        yield* opener.open(
          { kind: "attachment", attachmentKey: "EPUBSTR2" },
          "tab",
        ),
      ).toEqual({
        kind: "zotero",
        url: "zotero://open/library/items/EPUBSTR2",
      });

      expect(handed).toEqual(["zotero://open/library/items/EPUBSTR2"]);
      expect(opened).toEqual([]);
    }),
  );

  it.effect(
    "hands an Annotation Obsidian cannot host to Zotero, at the Annotation",
    () =>
      Effect.gen(function* () {
        const { opener, handed } = yield* openerFixture();

        yield* opener.open(
          { ...ANNOTATION, attachmentKey: "EPUBSTR2", pageLabel: "iv" },
          false,
        );

        expect(handed).toEqual([
          "zotero://open/library/items/EPUBSTR2?annotation=FDRFQ7C2&page=iv",
        ]);
      }),
  );

  it.effect(
    "hands an Attachment that keeps no file Zotero knows of to Zotero",
    () =>
      Effect.gen(function* () {
        const { opener, opened, handed } = yield* openerFixture();

        yield* opener.open(
          { kind: "attachment", attachmentKey: "LINKURL2" },
          false,
        );

        expect(handed).toEqual(["zotero://open/library/items/LINKURL2"]);
        expect(opened).toEqual([]);
      }),
  );

  // A synced library on a second computer names a file that never arrived;
  // that computer reaches the Attachment through Zotero instead.
  it.effect(
    "hands the target to Zotero when the reader finds no file at the open",
    () =>
      Effect.gen(function* () {
        const { opener, opened, handed } = yield* openerFixture({
          missing: [FILES.rougier],
        });

        expect(yield* opener.open(ANNOTATION, "tab")).toEqual({
          kind: "zotero",
          url: "zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2&page=2",
        });

        expect(handed).toEqual([
          "zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2&page=2",
        ]);
        expect(opened).toEqual([]);
      }),
  );

  it.effect("names a group-library target to Zotero by its group", () =>
    Effect.gen(function* () {
      const { opener, handed } = yield* openerFixture();

      yield* opener.open(
        {
          kind: "annotation",
          attachmentKey: "GRPMISS9g4200309",
          annotationKey: "FDRFQ7C2g4200309",
          pageIndex: null,
          pageLabel: null,
        },
        false,
      );

      expect(handed).toEqual([
        "zotero://open/groups/4200309/items/GRPMISS9?annotation=FDRFQ7C2",
      ]);
    }),
  );

  // A card clicked while the index is still building waits for it, rather
  // than sending a PDF this computer holds to Zotero.
  it.effect("waits for the first index before it decides", () =>
    Effect.gen(function* () {
      const { opener, opened, handed, service } = yield* openerFixture({
        prime: false,
      });
      expect(yield* service.lookup("RGRPDF24")).toEqual({ kind: "pending" });

      expect(
        yield* opener.open(
          { kind: "attachment", attachmentKey: "RGRPDF24" },
          false,
        ),
      ).toEqual({ kind: "reader" });
      expect(opened).toHaveLength(1);
      expect(handed).toEqual([]);
    }),
  );

  // An index that never comes must not swallow the click: past the wait, the
  // target opens in Zotero, as it did while the index was pending. A database
  // read that fails leaves the index unbuilt the same way.
  it.effect("opens in Zotero once the first index outlasts the wait", () =>
    Effect.gen(function* () {
      const { opener, opened, handed, failReads } = yield* openerFixture({
        prime: false,
      });
      failReads(true);

      const outcome = yield* opener
        .open(ANNOTATION, false)
        .pipe(Effect.forkScoped({ startImmediately: true }));
      yield* TestClock.adjust(4_999);
      expect(handed).toEqual([]);
      yield* TestClock.adjust(1);

      expect(yield* Fiber.join(outcome)).toEqual({
        kind: "zotero",
        url: "zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2&page=2",
      });
      expect(opened).toEqual([]);
      expect(handed).toHaveLength(1);
    }),
  );

  // A gesture's open ends with the plugin or the view that ran it: an open
  // still waiting for the index then reaches neither the reader nor Zotero.
  it.effect("opens nothing and reports nothing once interrupted", () =>
    Effect.gen(function* () {
      const { opener, opened, handed, notices, failReads } =
        yield* openerFixture({ prime: false });
      failReads(true);

      const outcome = yield* opener
        .open(ANNOTATION, false)
        .pipe(Effect.forkScoped({ startImmediately: true }));
      yield* TestClock.adjust(1_000);
      yield* Fiber.interrupt(outcome);
      yield* TestClock.adjust(10_000);

      expect(opened).toEqual([]);
      expect(handed).toEqual([]);
      expect(notices).toEqual([]);
    }),
  );

  it.effect("reports a reader that fails through the Notifier", () =>
    Effect.gen(function* () {
      const { opener, opened, handed, notices } = yield* openerFixture({
        broken: [FILES.rougier],
      });

      expect(yield* opener.open(ANNOTATION, false)).toEqual({
        kind: "failed",
      });

      expect(notices.map(({ messages }) => messages)).toEqual([
        [m.notice_pdf_open_failed()],
      ]);
      expect(opened).toEqual([]);
      expect(handed).toEqual([]);
    }),
  );

  it.effect("reports a system handler that fails through the Notifier", () =>
    Effect.gen(function* () {
      const { opener, notices } = yield* openerFixture({
        native: () => {
          throw new Error("no handler for zotero://");
        },
      });

      expect(
        yield* opener.open(
          { kind: "attachment", attachmentKey: "EPUBSTR2" },
          false,
        ),
      ).toEqual({ kind: "failed" });

      expect(notices.map(({ messages }) => messages)).toEqual([
        [m.notice_pdf_open_failed()],
      ]);
    }),
  );

  it.effect("opens nothing for a key that is no Indexed Key", () =>
    Effect.gen(function* () {
      const { opener, opened, handed } = yield* openerFixture();

      expect(
        yield* opener.open(
          { kind: "attachment", attachmentKey: "not a key" },
          false,
        ),
      ).toEqual({ kind: "unknown" });

      expect(opened).toEqual([]);
      expect(handed).toEqual([]);
    }),
  );
});

const STORED_LINK =
  "file:///fixture/zotero-data/storage/PDFSTR22/sakimas%20song.pdf";
const DURABLE =
  "zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2&page=2";

/** Follows `url` and runs the open it answers; fails a case left to the caller. */
const followed = Effect.fnUntraced(function* (
  opener: Effect.Success<ReturnType<typeof openerFixture>>["opener"],
  url: string,
  pane: Parameters<typeof opener.follow>[1],
) {
  const open = yield* opener.follow(url, pane);
  if (open === null) throw new Error(`the opener left ${url} to the caller`);
  return yield* open;
});

describe("follow", () => {
  it.effect.each<[string, string]>([
    ["a web link", "https://example.com/paper.pdf"],
    ["a string that is no URL", "not a url"],
    [
      "a file Zotero does not know",
      "file:///fixture/vault/attachments/other.pdf",
    ],
    [
      "a file Obsidian cannot host",
      "file:///fixture/zotero-data/storage/EPUBSTR2/sakimas-song.epub",
    ],
    ["a link that names no Annotation", "zotero://open/library/items/RGRPDF24"],
    [
      "a link to an Attachment Zotero holds no file for",
      "zotero://open/library/items/LINKURL2?annotation=FDRFQ7C2",
    ],
    [
      "a link to an Attachment Obsidian cannot host",
      "zotero://open/library/items/EPUBSTR2?annotation=FDRFQ7C2",
    ],
  ])("leaves %s to the caller", ([, url]) =>
    Effect.gen(function* () {
      const { opener, opened, handed } = yield* openerFixture();

      expect(yield* opener.follow(url, false)).toBeNull();

      expect(opened).toEqual([]);
      expect(handed).toEqual([]);
    }),
  );

  // Until the index lands ZotLit cannot name the file, and does not claim it.
  it.effect("leaves every link to the caller while the index is building", () =>
    Effect.gen(function* () {
      const { opener } = yield* openerFixture({ prime: false });

      expect(yield* opener.follow(STORED_LINK, false)).toBeNull();
      expect(yield* opener.follow(DURABLE, false)).toBeNull();
    }),
  );

  // A click handler claims the click before it returns, so the decision
  // reads only the index held now and opens nothing yet.
  it.effect("decides at once, and opens only when its open runs", () =>
    Effect.gen(function* () {
      const { opener, opened, bridge } = yield* openerFixture();

      const open = bridge.runSync(opener.follow(DURABLE, false));

      expect(open).not.toBeNull();
      expect(opened).toEqual([]);
    }),
  );

  it.effect(
    "opens an Attachment File Link in Obsidian's reader at the page it names",
    () =>
      Effect.gen(function* () {
        const { opener, opened } = yield* openerFixture();

        expect(
          yield* followed(opener, `${STORED_LINK}#page=7`, "split"),
        ).toEqual({ kind: "reader" });

        expect(opened).toEqual([
          {
            attachment: {
              indexedKey: "PDFSTR22",
              label: "sakimas song.pdf",
              openPath: `file:${FILES.stored}`,
              absolutePath: FILES.stored,
              subpath: "#page=7",
            },
            pane: "split",
          },
        ]);
      }),
  );

  it.effect(
    "opens an in-vault Attachment File Link by its vault-relative path",
    () =>
      Effect.gen(function* () {
        const { opener, opened } = yield* openerFixture();

        yield* followed(opener, `file://${FILES.rougier}`, false);

        expect(opened[0]?.attachment).toMatchObject({
          indexedKey: "RGRPDF24",
          openPath: "attachments/rougier-2014.pdf",
        });
      }),
  );

  // An Attachment File Link names nothing Zotero can open in its stead, so
  // the caller says the file is missing.
  it.effect(
    "reports a missing file behind an Attachment File Link, and hands nothing to Zotero",
    () =>
      Effect.gen(function* () {
        const { opener, handed } = yield* openerFixture({
          missing: [FILES.stored],
        });

        expect(yield* followed(opener, STORED_LINK, false)).toEqual({
          kind: "file-missing",
        });

        expect(handed).toEqual([]);
      }),
  );

  it.effect("opens a Durable Annotation Link at the Annotation it names", () =>
    Effect.gen(function* () {
      const { opener, opened } = yield* openerFixture();

      expect(yield* followed(opener, DURABLE, "tab")).toEqual({
        kind: "reader",
      });

      expect(opened).toEqual([
        {
          attachment: {
            indexedKey: "RGRPDF24",
            label: "rougier-2014.pdf",
            openPath: "attachments/rougier-2014.pdf",
            absolutePath: FILES.rougier,
            subpath: "#page=2&zt-annotation=FDRFQ7C2",
          },
          pane: "tab",
        },
      ]);
    }),
  );

  it.effect(
    "leaves a Durable Annotation Link to Zotero when the Reader setting is off",
    () =>
      Effect.gen(function* () {
        const { opener, opened, handed } = yield* openerFixture({
          settings: {
            ...defaults,
            "reader.open-annotation-links": false,
          },
        });

        expect(yield* opener.follow(DURABLE, false)).toBeNull();
        expect(opened).toEqual([]);
        expect(handed).toEqual([]);
      }),
  );

  it.effect(
    "opens the Attachment a Durable Annotation Link names where another keeps the same file",
    () =>
      Effect.gen(function* () {
        const { opener, opened } = yield* openerFixture();

        yield* followed(
          opener,
          "zotero://open/library/items/RGRCPYB8?annotation=FDRFQ7C2",
          false,
        );

        expect(opened.map(({ attachment }) => attachment.indexedKey)).toEqual([
          "RGRCPYB8",
        ]);
      }),
  );

  // The fragment carries no library segment of its own, so both keys travel
  // as Indexed Keys — the form an Annotation Record's key already takes.
  it.effect("names a group-library Annotation by its Indexed Key", () =>
    Effect.gen(function* () {
      const { opener, opened } = yield* openerFixture();

      yield* followed(
        opener,
        "zotero://open/groups/4200309/items/RGRGRUP9?annotation=FDRFQ7C2&page=2",
        false,
      );

      expect(opened[0]?.attachment).toMatchObject({
        indexedKey: "RGRGRUP9g4200309",
        absolutePath: FILES.grouped,
        subpath: "#page=2&zt-annotation=FDRFQ7C2g4200309",
      });
    }),
  );

  // `page` is a printed label. Only a label that reads as a page number can
  // stand in for Obsidian's own jump; the Annotation's own page wins anyway.
  it.effect("leaves out a page label that is no page number", () =>
    Effect.gen(function* () {
      const { opener, opened } = yield* openerFixture();

      yield* followed(
        opener,
        "zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2&page=iv",
        false,
      );

      expect(opened[0]?.attachment.subpath).toBe("#zt-annotation=FDRFQ7C2");
    }),
  );

  it.effect(
    "hands a Durable Annotation Link to Zotero as written when the reader finds no file",
    () =>
      Effect.gen(function* () {
        const { opener, handed } = yield* openerFixture({
          missing: [FILES.rougier],
        });
        const link =
          "zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2&page=iv";

        expect(yield* followed(opener, link, false)).toEqual({
          kind: "zotero",
          url: link,
        });

        expect(handed).toEqual([link]);
      }),
  );

  it.effect(
    "reports a reader that fails a followed link through the Notifier",
    () =>
      Effect.gen(function* () {
        const { opener, notices } = yield* openerFixture({
          broken: [FILES.stored],
        });

        expect(yield* followed(opener, STORED_LINK, false)).toEqual({
          kind: "failed",
        });

        expect(notices.map(({ messages }) => messages)).toEqual([
          [m.notice_pdf_open_failed()],
        ]);
      }),
  );
});
