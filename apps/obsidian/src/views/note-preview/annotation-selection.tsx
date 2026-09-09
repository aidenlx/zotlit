import { useStore } from "zustand";

import { AnnotationSampleBar } from "@zotlit/workbench/ui";

import type { NativePreviewSession } from "./session";

export function PreviewAnnotationSelection({
  session,
}: {
  session: NativePreviewSession;
}) {
  const { current, example } = useStore(session.state, (state) => state);
  return (
    <AnnotationSampleBar
      compact
      current={current}
      example={example}
      onSelect={(id) => session.select(id)}
    />
  );
}
