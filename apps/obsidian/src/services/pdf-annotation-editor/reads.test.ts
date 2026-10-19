import { expect, it } from "vitest";

import { PdfReads } from "./reads";

// Failure modes: page turns bypass the five-minute boundary across views;
// open/close get throttled; another Attachment shares the throttle; standalone
// Attachments record Uses; delayed resolution changes an open's own instant.
it("records opens and closes, and limits page reads per Attachment to five minutes", () => {
  let now = Temporal.Instant.from("2026-10-19T00:00:00Z");
  const recorded: {
    attachmentKey: string;
    itemKey: string;
    instant: Temporal.Instant;
  }[] = [];
  const reads = new PdfReads({
    now: () => now,
    record: (read) => recorded.push(read),
  });
  const target = {
    serverID: null,
    attachmentKey: "PDFABCDE",
    itemKey: "AAAAAAAA",
  };
  reads.record(target, "open");
  now = now.add({ minutes: 4, seconds: 59 });
  reads.record(target, "page");
  expect(recorded.map((r) => r.instant.toString())).toEqual([
    "2026-10-19T00:00:00Z",
  ]);
  now = now.add({ seconds: 1 });
  reads.record(target, "page");
  reads.record(target, "page");
  expect(recorded.map((r) => r.instant.toString())).toEqual([
    "2026-10-19T00:00:00Z",
    "2026-10-19T00:05:00Z",
  ]);
  now = now.add({ seconds: 1 });
  reads.record(target, "close");
  reads.record(target, "open");
  expect(recorded).toHaveLength(4);
  expect(recorded[3]?.instant.toString()).toBe("2026-10-19T00:05:01Z");
});

it("keeps Attachments independent, excludes standalone reads and preserves a delayed open's instant", () => {
  const now = Temporal.Instant.from("2026-10-19T00:10:00Z");
  const recorded: {
    attachmentKey: string;
    itemKey: string;
    instant: Temporal.Instant;
  }[] = [];
  const reads = new PdfReads({
    now: () => now,
    record: (read) => recorded.push(read),
  });
  reads.record(
    { serverID: null, attachmentKey: "PDFABCDE", itemKey: "AAAAAAAA" },
    "open",
  );
  reads.record(
    { serverID: null, attachmentKey: "PDFOTHER", itemKey: "AAAAAAAA" },
    "page",
  );
  reads.record(
    { serverID: null, attachmentKey: "PDFALONE", itemKey: null },
    "open",
  );
  reads.record(
    { serverID: null, attachmentKey: "PDFALONE", itemKey: null },
    "page",
  );
  reads.record(
    { serverID: null, attachmentKey: "PDFALONE", itemKey: null },
    "close",
  );
  const opened = Temporal.Instant.from("2026-10-19T00:00:00Z");
  reads.record(
    { serverID: null, attachmentKey: "PDFABCDE", itemKey: "AAAAAAAA" },
    "open",
    opened,
  );
  reads.record(
    { serverID: null, attachmentKey: "PDFABCDE", itemKey: "AAAAAAAA" },
    "page",
  );
  expect(recorded.map((r) => [r.attachmentKey, r.instant.toString()])).toEqual([
    ["PDFABCDE", "2026-10-19T00:10:00Z"],
    ["PDFOTHER", "2026-10-19T00:10:00Z"],
    ["PDFABCDE", "2026-10-19T00:00:00Z"],
  ]);
});
