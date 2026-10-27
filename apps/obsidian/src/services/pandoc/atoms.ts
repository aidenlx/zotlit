// Engine status and render revisions shared by bibliography reading surfaces.
import { Effect, Stream } from "effect";

import { held } from "@/lib/view-atoms";

import { BibliographyRender } from "./render-cache";
import { PandocEngine } from "./service";
import type { PandocEngineStatus } from "./service";

export const pandocEngineAtom = held<PandocEngineStatus>(
  Stream.unwrap(Effect.map(PandocEngine, (engine) => engine.changes)),
  { kind: "absent" },
);

export const bibliographyRevisionsAtom = held(
  Stream.unwrap(
    Effect.map(BibliographyRender, (renders) =>
      Stream.scan(
        renders.events,
        (): Readonly<Record<string, number>> => ({}),
        (revisions, event) => {
          const key = event._tag === "invalidated" ? "*" : event.key;
          return { ...revisions, [key]: (revisions[key] ?? 0) + 1 };
        },
      ),
    ),
  ),
  {},
);
