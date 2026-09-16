import { describe, expect, it } from "vitest";

import type { ReaderTarget } from "@/services/local-server/service";

import { ReaderSessionHost } from "./session";
import type { ReaderSessionTarget } from "./session";
import { ZoteroReaderSession } from "./zotero";
import type { ZoteroReaderSessionDeps } from "./zotero";

const PAPER: ReaderSessionTarget = {
  attachmentKey: "ATCH2345",
  itemKey: "ITEM2345",
};
const STANDALONE: ReaderSessionTarget = {
  attachmentKey: "LSTAND23",
  itemKey: null,
};

/** Records what each side of the session saw, so a test asserts events. */
function watch(session: ReaderSessionHost) {
  const targets: (ReaderSessionTarget | null)[] = [];
  const selections: readonly string[][] = [];
  session.on("target-changed", (target) => targets.push(target));
  session.on("selection-changed", (selected) =>
    (selections as string[][]).push([...selected]),
  );
  return { targets, selections };
}

function host(select?: (keys: readonly string[]) => void) {
  const navigated: string[] = [];
  const asked: readonly string[][] = [];
  const session = new ReaderSessionHost({
    source: "obsidian-pdf",
    navigate: (key) => navigated.push(key),
    select: (keys) => {
      (asked as string[][]).push([...keys]);
      select?.(keys);
    },
  });
  return { session, navigated, asked };
}

describe("ReaderSessionHost", () => {
  it("names its source and starts holding nothing", () => {
    const { session } = host();
    expect(session.source).toBe("obsidian-pdf");
    expect(session.target).toBe(null);
    expect(session.selected).toEqual([]);
  });

  it("announces a target only when it moves", () => {
    const { session } = host();
    const seen = watch(session);

    session.setTarget(PAPER);
    session.setTarget({ ...PAPER });
    session.setTarget(STANDALONE);
    session.setTarget(null);

    expect(seen.targets).toEqual([PAPER, STANDALONE, null]);
    expect(session.target).toBe(null);
  });

  it("carries a standalone Attachment with no parent Item", () => {
    const { session } = host();
    session.setTarget(STANDALONE);
    expect(session.target).toEqual({
      attachmentKey: "LSTAND23",
      itemKey: null,
    });
  });

  it("drops the selection when the Attachment changes", () => {
    const { session } = host();
    session.setTarget(PAPER);
    session.reportSelection(["ANNO2345"]);
    const seen = watch(session);

    session.setTarget(STANDALONE);

    expect(seen.selections).toEqual([[]]);
    expect(seen.targets).toEqual([STANDALONE]);
    expect(session.selected).toEqual([]);
  });

  it("announces a selection only when the keys move", () => {
    const { session } = host();
    const seen = watch(session);

    session.reportSelection(["A2345678", "B2345678"]);
    session.reportSelection(["A2345678", "B2345678"]);
    session.reportSelection(["B2345678", "A2345678"]);

    expect(seen.selections).toEqual([
      ["A2345678", "B2345678"],
      ["B2345678", "A2345678"],
    ]);
  });

  it("passes both gestures to the reader that owns them", () => {
    const { session, navigated, asked } = host();
    session.navigateToAnnotation("ANNO2345");
    session.setSelectedAnnotations(["ANNO2345"]);
    expect(navigated).toEqual(["ANNO2345"]);
    expect(asked).toEqual([["ANNO2345"]]);
  });

  it("holds the selection a reader answers with, and no other", () => {
    // A reader that cannot be told what to select reports nothing back.
    const deaf = host();
    deaf.session.setSelectedAnnotations(["ANNO2345"]);
    expect(deaf.session.selected).toEqual([]);

    const echo: ReaderSessionHost = new ReaderSessionHost({
      source: "obsidian-pdf",
      navigate: () => undefined,
      select: (keys) => echo.reportSelection(keys),
    });
    echo.setSelectedAnnotations(["ANNO2345"]);
    expect(echo.selected).toEqual(["ANNO2345"]);
  });

  it("announces nothing after disposal", () => {
    const { session } = host();
    const seen = watch(session);
    session[Symbol.dispose]();
    session.setTarget(PAPER);
    expect(seen.targets).toEqual([]);
  });
});

/** The companion's push, in the numeric ids the wire carries. */
const PUSHED: ReaderTarget = { itemID: 1, attachmentID: 2, selected: [7] };

type LiveUpdatePort = ZoteroReaderSessionDeps["liveUpdate"];

function liveUpdate(initial: ReaderTarget | null) {
  let pushed = initial;
  const listeners = new Set<(target: ReaderTarget) => void>();
  const stub: LiveUpdatePort = {
    get readerTarget() {
      return pushed;
    },
    on: ((event: string, cb: (target: ReaderTarget) => void) => {
      expect(event).toBe("reader/target");
      listeners.add(cb);
      return () => listeners.delete(cb);
    }) as LiveUpdatePort["on"],
  };
  return {
    stub,
    push(target: ReaderTarget) {
      pushed = target;
      for (const cb of listeners) cb(target);
    },
    get subscribers() {
      return listeners.size;
    },
  };
}

describe("ZoteroReaderSession", () => {
  function build(initial: ReaderTarget | null = null) {
    const live = liveUpdate(initial);
    const navigated: string[] = [];
    const session = new ZoteroReaderSession({
      liveUpdate: live.stub,
      navigate: (key) => navigated.push(key),
      resolve: (target) =>
        target.attachmentID === 2
          ? { target: PAPER, selected: ["ANNO2345"] }
          : null,
    });
    return { live, session, navigated };
  }

  it("names the Zotero source and seeds from the push the listener holds", () => {
    const { session } = build(PUSHED);
    expect(session.source).toBe("zotero");
    expect(session.target).toEqual(PAPER);
    expect(session.selected).toEqual(["ANNO2345"]);
  });

  it("translates each push into Indexed Keys", () => {
    const { live, session } = build();
    expect(session.target).toBe(null);

    live.push(PUSHED);
    expect(session.target).toEqual(PAPER);
    expect(session.selected).toEqual(["ANNO2345"]);

    // A push the database cannot name leaves the session holding nothing.
    live.push({ itemID: 9, attachmentID: 9, selected: [] });
    expect(session.target).toBe(null);
    expect(session.selected).toEqual([]);
  });

  it("takes no selection from a consumer, because Zotero owns its reader", () => {
    const { session } = build(PUSHED);
    session.setSelectedAnnotations([]);
    expect(session.selected).toEqual(["ANNO2345"]);
  });

  it("re-reads the held push on refresh", () => {
    const { live, session } = build();
    live.push(PUSHED);
    session.setTarget(null);
    session.refresh();
    expect(session.target).toEqual(PAPER);
  });

  it("stops tracking the listener when disposed", () => {
    const { live, session } = build();
    session[Symbol.dispose]();
    expect(live.subscribers).toBe(0);
  });

  it("opens an annotation through the port Zotero gave it", () => {
    const { session, navigated } = build(PUSHED);
    session.navigateToAnnotation("ANNO2345");
    expect(navigated).toEqual(["ANNO2345"]);
  });
});
