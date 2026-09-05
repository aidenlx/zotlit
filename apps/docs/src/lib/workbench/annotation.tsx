// Access to the Annotation Section when the note has no render call, and the
// Source mode section bar with its repair action.

import type {
  WorkbenchDocumentController,
  WorkbenchSliceRange,
} from "@zotlit/workbench/document";

import { Button } from "@/components/ui/button";
import { m } from "@/paraglide/messages.js";

/**
 * The format's place under a note that calls it nowhere: the host puts the
 * call, and the loop around it, where the reader left the caret, and the box
 * opens there.
 */
export function AnnotationPointer({ onInsert }: { onInsert: () => void }) {
  return (
    <div className="mt-3 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-fd-border bg-fd-card px-3 py-2">
      <span className="text-sm font-medium">
        {m.workbench_annotation_label()}
      </span>
      <span className="text-sm text-fd-muted-foreground">
        {m.workbench_annotation_pointer()}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={onInsert}
        className="ms-auto"
      >
        {m.workbench_annotation_insert()}
      </Button>
    </div>
  );
}

/**
 * Advanced's own bar over the whole file: the section it holds, or the repair
 * action for the document that has none.
 */
export function AnnotationSectionBar({
  controller,
  onGo,
}: {
  controller: WorkbenchDocumentController;
  onGo: (header: WorkbenchSliceRange) => void;
}) {
  const section = controller.annotationSection;
  // A document mid-repair can hold the section ranges it had, so the refusal
  // the parser raises decides which of the two actions the bar offers.
  const missing = controller.problems.some(
    ({ code }) => code === "missing-annotation-section",
  );
  return (
    <div className="mb-2 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-fd-border bg-fd-card px-3 py-2">
      <span className="text-sm font-medium">
        {m.workbench_section_heading()}
      </span>
      {missing ? (
        <>
          <span className="text-sm text-fd-muted-foreground">
            {m.workbench_section_missing()}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => controller.repairAnnotationSection()}
            className="ml-auto"
          >
            {m.workbench_section_repair()}
          </Button>
        </>
      ) : (
        section && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onGo({ ...section.header })}
            className="ml-auto"
          >
            {m.workbench_section_go()}
          </Button>
        )
      )}
    </div>
  );
}
