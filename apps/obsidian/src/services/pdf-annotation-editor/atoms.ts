// Reader sessions observed by the Annotation View through its registry.
import { Effect, Stream } from "effect";

import { held } from "@/lib/view-atoms";

import { PdfAnnotationEditor } from "./service";

/** The live sessions, refreshed when a late PDF binding becomes available. */
export const pdfSessionsAtom = held(
  Stream.unwrap(Effect.map(PdfAnnotationEditor, (editor) => editor.sessions)),
  new Map(),
);
