import { expect, it, vi } from "vitest";

import { CapabilityNotices } from "./notices";
import { IDLE } from "./write";

/** The two dependencies the gesture runs through, each recording its order. */
function seam() {
  const ran: string[] = [];
  let release: (() => void) | null = null;
  const notices = new CapabilityNotices({
    capabilities: {
      capabilityFor: () => ({ kind: "writable" }),
      mutationFor: () => IDLE,
      on: () => () => undefined,
      probe: vi.fn(async () => {
        ran.push("probe");
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }),
    },
    writes: { on: () => () => undefined },
    openEditingSettings: vi.fn(() => ran.push("open")),
    cardShown: () => true,
    revealAnnotation: vi.fn(() => ran.push("reveal")),
  });
  return {
    notices,
    ran,
    /** Lets the probe in flight answer. */
    answerProbe: () => release?.(),
  };
}

it("re-checks Zotero before it opens the editing settings row", async () => {
  const { notices, ran, answerProbe } = seam();
  await using _notices = notices;
  await notices.ready;

  const gesture = notices.showEditingCapability();
  // The row waits for the probe: it renders the capability, and a stale one
  // would name a state Zotero has already left.
  expect(ran).toEqual(["probe"]);

  answerProbe();
  await gesture;
  expect(ran).toEqual(["probe", "open"]);
});
