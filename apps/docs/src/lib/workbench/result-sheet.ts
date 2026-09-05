// The reading view behind a lazy import: it carries the Markdown parser stack,
// the largest part of the editor bundle, and is read only once a render has
// answered, so it arrives behind the editor rather than ahead of it. Every
// pane that shows a rendered note reads this one binding, so no static edge
// into the reading view pulls the stack back into the editor chunk.

import { lazy } from "react";

export const ResultSheet = lazy(() =>
  import("./reading-view").then((module) => ({ default: module.ResultSheet })),
);
