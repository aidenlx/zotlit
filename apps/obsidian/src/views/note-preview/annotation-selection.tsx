import { useAtomValue, RegistryContext } from "@effect/atom-react";

import { AnnotationSampleBar } from "@zotlit/workbench/ui";

import type { NativePreviewSession } from "./session";

export function PreviewAnnotationSelection({
  session,
}: {
  session: NativePreviewSession;
}) {
  return (
    <RegistryContext.Provider value={session.state.registry}>
      <Selection session={session} />
    </RegistryContext.Provider>
  );
}
function Selection({ session }: { session: NativePreviewSession }) {
  const { current, example } = useAtomValue(session.state.model.state);
  return (
    <AnnotationSampleBar
      compact
      current={current}
      example={example}
      onSelect={(id) => session.select(id)}
    />
  );
}
