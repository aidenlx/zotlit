import { it } from "@effect/vitest";
import { Effect } from "effect";
import { expect } from "vitest";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import { WriteRunFailed } from "@/services/annotation-repository/service";
import type { AnnotationRepository } from "@/services/annotation-repository/service";

import { READER_NOW } from "./__fixtures__";
import { stepMarkHistory } from "./operations";

it.effect(
  "says a History Step that failed before Zotero answered has an unknown outcome",
  () =>
    Effect.gen(function* () {
      const notifier = testNotifier();
      const annotations = stubService<
        Pick<AnnotationRepository["Service"], "undo" | "redo">
      >("AnnotationRepository", {
        undo: () =>
          Effect.fail(new WriteRunFailed({ cause: new Error("Reply lost") })),
      });

      const outcome = yield* stepMarkHistory(annotations, notifier.service, {
        attachmentKey: "RGRPDF24",
        direction: "undo",
        speaks: () => true,
        now: () => READER_NOW,
      });

      expect(outcome).toEqual({
        kind: "failed",
        failure: { kind: "unknown-outcome" },
      });
      expect(notifier.notices.map(({ messages }) => messages)).toEqual([
        [
          m.annot_view_write_failed({
            reason: m.annot_view_write_reason_unknown_outcome(),
          }),
        ],
      ]);
    }),
);
