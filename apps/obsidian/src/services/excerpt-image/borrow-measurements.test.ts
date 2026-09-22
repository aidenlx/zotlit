import { writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import { runReaderMeasurements } from "./borrow-measurements";

// The detached path reaches PDF.js through Obsidian; the harness installs its
// own counting stand-in on this spy.
vi.mock("obsidian", async (original) => ({
  ...(await original<typeof import("obsidian")>()),
  loadPdfJs: vi.fn(),
}));

// The harness models PDF work and drives the real proof over real files, so it
// runs only when asked; the normal suite never pays for it.
describe.runIf(process.env.ZOTLIT_BORROW_MEASUREMENTS === "1")(
  "Reader-borrow measurements",
  () => {
    it("records reader-open, no-reader, import, changed-file, and repeat passes", async () => {
      const record = await runReaderMeasurements();
      const serialized = JSON.stringify(record, null, 2);
      process.stdout.write(`${serialized}\n`);
      const out = process.env.ZOTLIT_BORROW_MEASUREMENTS_OUT;
      if (out) await writeFile(out, `${serialized}\n`, "utf8");

      // A reader holding current documents loads no PDF at all, while the
      // same corpus with no reader parses one document per PDF.
      expect(record.readerOpen.loads).toBe(0);
      expect(record.readerOpen.renders).toBe(record.corpus.excerpts);
      expect(record.noReader.loads).toBe(record.corpus.pdfs);
      expect(record.noReader.renders).toBe(record.corpus.excerpts);
      // A proven document is not re-read: one proof per document, not per crop.
      expect(record.readerOpen.documentBytes).toBe(record.corpus.pdfs);
      // The import that follows the reader is pure cache.
      expect(record.importAfterReader.hits).toBe(record.corpus.excerpts);
      expect(record.importAfterReader.loads).toBe(0);
      expect(record.importAfterReader.renders).toBe(0);
      // One reader document holds pre-edit bytes: the file's move is proven
      // again once, and only that file is loaded from disk.
      expect(record.changedOnDisk.documentBytes).toBe(1);
      expect(record.changedOnDisk.loads).toBe(1);
      expect(record.changedOnDisk.renders).toBe(record.corpus.excerpts);
      // A document proven earlier in the process is never proven again.
      expect(record.repeatedSinglePdf.documentBytes).toBe(0);
      expect(record.repeatedSinglePdf.loads).toBe(0);
      expect(record.repeatedSinglePdf.renders).toBe(
        record.corpus.excerptsPerPdf,
      );
    }, 120_000);
  },
);
