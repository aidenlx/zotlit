// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import { Effect, Layer, Logger, References } from "effect";
import { ButtonComponent, ConfirmationModal, TFile } from "obsidian";
import type { App, Workspace } from "obsidian";
import { expect, vi } from "vitest";

import { MissingTemplateError } from "@zotlit/templates/facade";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import { Workspace as WorkspaceTag } from "@/lib/obsidian-workspace";
import { LibraryScope } from "@/services/library-scope/service";
import { NoteImporter } from "@/services/note-import/service";
import { NoteIndex } from "@/services/note-index/service";
import { Profile } from "@/services/profile/service";
import { PluginSettings } from "@/services/settings/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import { readsAnswering } from "@/services/zotero-reads/__fixtures__";
import { DbUnavailable } from "@/services/zotero-reads/rpc";
import { ZoteroReads } from "@/services/zotero-reads/service";
import type {
  ZoteroReadsApi,
  ZoteroReadsState,
} from "@/services/zotero-reads/service";

import {
  overwriteNote,
  overwriteNoteToast,
  reimportNoteToast,
  updateAll,
} from "./actions-view";
import type { NoteActionPorts, NoteActionServices } from "./actions-view";
import { NoteWriteAborted } from "./errors";
import { NoteFeature } from "./service";
import type { BatchUpdatePorts } from "./update-batch";

function appStub(): App {
  return stubService<App>("App", {
    workspace: stubService<Workspace>("Workspace", { trigger: vi.fn() }),
  });
}

// Every Literature Note write that hits a missing partial names it and offers
// the route back to the Workbench; create and single update already did.
it.each([
  ["overwrite", () => overwriteNoteToast({ app: appStub() }).error],
  [
    "reimport",
    () => reimportNoteToast({ app: appStub(), path: "Books/Reading.md" }).error,
  ],
] as const)("names the missing partial when %s fails on one", (_name, make) => {
  const error = make();
  const notice =
    typeof error === "function"
      ? error(new MissingTemplateError("venue-line"))
      : error;

  expect(notice).toBeInstanceOf(DocumentFragment);
  expect((notice as DocumentFragment).textContent).toContain(
    m.notice_note_missing_partial({ name: "venue-line" }),
  );
});

/**
 * The note actions' services, with `feature` as the Note Feature, `reads`
 * as the Zotero database in `state`, and the notices recorded.
 */
function actions(
  feature: Partial<NoteFeature["Service"]> = {},
  database: { state: ZoteroReadsState["state"]; reads?: ZoteroReadsApi } = {
    state: "loading",
  },
) {
  const reads =
    database.reads ?? stubService<ZoteroReadsApi>("ZoteroReadsApi", {});
  const notifier = testNotifier();
  const layer: Layer.Layer<NoteActionServices> = Layer.mergeAll(
    Layer.mock(NoteFeature, feature),
    notifier.layer,
    Layer.mock(LibraryScope, {}),
    Layer.mock(MetadataCache, {}),
    Layer.mock(NoteImporter, {}),
    Layer.mock(NoteIndex, {}),
    Layer.mock(PluginSettings, {}),
    Layer.mock(Profile, {}),
    Layer.mock(WorkspaceTag, {}),
    Layer.mock(ZoteroReads, {
      current: Effect.succeed(
        stubService<ZoteroReadsState>("ZoteroReadsState", {
          state: database.state,
        }),
      ),
      reads,
      snapshot: Effect.succeed(reads),
    }),
    Layer.mock(ZoteroPref, {}),
  );
  const ports = stubService<NoteActionPorts>("NoteActionPorts", {
    app: appStub(),
    batchUpdate: stubService<BatchUpdatePorts>("BatchUpdatePorts", {}),
  });
  return { notifier, layer, ports };
}

/** The first message of each notice. */
function texts(harness: ReturnType<typeof actions>): unknown[] {
  return harness.notifier.notices.map(({ messages: [message] }) => message);
}

/** The error logs of `run`, by message and annotations. */
const errorLogs = Effect.fnUntraced(function* <A, E, R>(
  run: Effect.Effect<A, E, R>,
) {
  const errors: {
    message: unknown;
    annotations: Readonly<Record<string, unknown>>;
  }[] = [];
  yield* run.pipe(
    Effect.provide(
      Logger.layer([
        Logger.make(({ logLevel, message, fiber }) => {
          if (logLevel !== "Error") return;
          errors.push({
            message: Array.isArray(message) ? message[0] : message,
            annotations: fiber.getRef(References.CurrentLogAnnotations),
          });
        }),
      ]),
    ),
  );
  return errors;
});

it.effect("reports an update all that the loading database stopped", () =>
  Effect.gen(function* () {
    const harness = actions();
    yield* updateAll(harness.ports).pipe(Effect.provide(harness.layer));
    expect(texts(harness)).toEqual([m.batch_update_db_unavailable()]);
  }),
);

it.effect("logs an update all that failed, with no notice", () =>
  Effect.gen(function* () {
    const failure = new DbUnavailable({ message: "the read failed" });
    const harness = actions(
      {},
      {
        state: "ready",
        reads: readsAnswering({ Libraries: () => Effect.fail(failure) }),
      },
    );
    const errors = yield* errorLogs(
      updateAll(harness.ports).pipe(Effect.provide(harness.layer)),
    );
    expect(errors).toEqual([
      {
        message: "Toast reported error",
        annotations: expect.objectContaining({ error: failure }),
      },
    ]);
    expect(texts(harness)).toEqual([]);
  }),
);

/** The Confirm or Cancel answer of the confirmation dialog, as the user gives it. */
function answerConfirmation(confirmed: boolean) {
  const opened = vi
    .spyOn(ConfirmationModal.prototype, "open")
    .mockImplementation(function (this: ConfirmationModal) {
      if (!confirmed) return this.close();
      const button = clicked.mock.calls.at(-1)![0];
      button({} as MouseEvent);
    });
  const clicked = vi.spyOn(ButtonComponent.prototype, "onClick");
  return {
    [Symbol.dispose]() {
      opened.mockRestore();
      clicked.mockRestore();
    },
  };
}

it.effect("leaves the note as it was when the user cancels the overwrite", () =>
  Effect.gen(function* () {
    using _answer = answerConfirmation(false);
    const overwrite = vi.fn<NoteFeature["Service"]["overwriteNote"]>();
    const harness = actions({ overwriteNote: overwrite });
    yield* overwriteNote(harness.ports, new TFile(), "ABCD2345").pipe(
      Effect.provide(harness.layer),
    );
    expect(overwrite).not.toHaveBeenCalled();
    expect(texts(harness)).toEqual([]);
  }),
);

it.effect(
  "names the missing partial that a confirmed overwrite's render threw",
  () =>
    Effect.gen(function* () {
      using _answer = answerConfirmation(true);
      const file = new TFile();
      const overwrite = vi.fn<NoteFeature["Service"]["overwriteNote"]>(() =>
        Effect.fail(
          new NoteWriteAborted({
            path: "Books/Paper.md",
            cause: new MissingTemplateError("venue-line"),
          }),
        ),
      );
      const harness = actions({ overwriteNote: overwrite });
      yield* overwriteNote(harness.ports, file, "ABCD2345").pipe(
        Effect.provide(harness.layer),
      );
      expect(overwrite).toHaveBeenCalledExactlyOnceWith(file, "ABCD2345");
      const [notice] = texts(harness);
      expect((notice as DocumentFragment).textContent).toContain(
        m.notice_note_missing_partial({ name: "venue-line" }),
      );
    }),
);
