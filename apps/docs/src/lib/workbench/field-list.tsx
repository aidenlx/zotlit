// Web adapter for the shared field discovery tree.
import { DataExplorer } from "@zotlit/workbench/ui";
import type { DataExplorerProps } from "@zotlit/workbench/ui";

import { FIELD_TRIGGER } from "./fields";

export type FieldListProps = Omit<DataExplorerProps, "copy">;
export function FieldList(props: FieldListProps) {
  return (
    <DataExplorer
      {...props}
      trigger={FIELD_TRIGGER}
      copy={(text) => navigator.clipboard.writeText(text)}
    />
  );
}
