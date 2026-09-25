// What a consumer sees when a batch reuses an excerpt: the real pipeline, run
// through the scope the batch handed out, with the renderer's call count as the
// evidence. Consumer tests whose subject is the batch (not excerpt rendering)
// resolve this one request once per note they drive, then read `renders` to
// tell a shared retention from a per-note one.
import { vi } from "vitest";

import { bluePng } from "@/services/excerpt-image/__fixtures__/png";
import { PNG_FORMAT } from "@/services/excerpt-image/format";
import type { ExcerptOutcomeScope } from "@/services/excerpt-image/outcome-scope";
import { ExcerptImageService } from "@/services/excerpt-image/service";
import type {
  ExcerptOutcome,
  ExcerptRequest,
} from "@/services/excerpt-image/service";

/** The one excerpt every note driven through a probe asks for. */
const reusedRequest: ExcerptRequest = {
  annotation: {
    key: "REUSE001",
    parentKey: "ATTACH01",
    type: "image",
    color: "#ff0000",
    comment: null,
    text: null,
    pageLabel: "1",
    sortIndex: "00000|000000|00000",
    tags: [],
    version: null,
    position: { kind: "pdf-rects", pageIndex: 0, rects: [[10, 20, 80, 90]] },
  },
  source: {
    kind: "zotero-db",
    database: { userID: 1, localUserKey: "LOCAL", serverID: "SERVER" },
    libraryID: 1,
    libraryRevision: 1,
  },
  sourceScope: "/zotero",
  libraryID: 1,
  attachmentKey: "ATTACH01",
  pdfPath: "/paper.pdf",
  zoteroPngPath: null,
};

export interface ExcerptReuseProbe extends AsyncDisposable {
  /** The renderer's call count: the renders the batch's notes really needed. */
  renders(): number;
  /** Resolve the probe's excerpt through the scope a note's batch gave it. */
  resolve(outcomes: ExcerptOutcomeScope | undefined): Promise<ExcerptOutcome>;
}

/**
 * A counting renderer behind the production service and scope; the probe keeps
 * no persistent store, so what a later request reuses is the batch's own
 * retention and nothing else.
 */
export function excerptReuseProbe(): ExcerptReuseProbe {
  const render = vi.fn(async () => ({ bytes: bluePng, format: PNG_FORMAT }));
  const service = new ExcerptImageService({ render });
  return {
    renders: () => render.mock.calls.length,
    // The probe owns the operation it acquires, so the service's active count
    // comes back down the way a consumer's does and the batch it drives runs at
    // the lifetime production gives it.
    resolve: async (outcomes) => {
      await using operation = service.operation({ outcomes });
      return await operation.resolve(reusedRequest);
    },
    [Symbol.asyncDispose]: () => service[Symbol.asyncDispose](),
  };
}
