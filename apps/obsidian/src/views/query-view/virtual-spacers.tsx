// The spacers that stand for the entries a long list leaves out: one row of
// a list, or one body of a table, as high as those entries.
import type { CSSProperties } from "react";

/** The height of the left-out entries, read back by a utility. */
const gap = (height: number) =>
  ({ "--zt-virtual-gap": `${height}px` }) as CSSProperties;

/** The room of the entries a long list leaves out. */
export function ListSpacer({ height }: { height: number }) {
  return (
    <li
      aria-hidden="true"
      className="zt:h-(--zt-virtual-gap) zt:list-none"
      style={gap(height)}
      data-query-spacer=""
    />
  );
}

/** The room of the rows a long table leaves out, across `span` columns. */
export function TableSpacer({
  height,
  span,
}: {
  height: number;
  span: number;
}) {
  return (
    <tbody aria-hidden="true" data-query-spacer="">
      <tr>
        <td
          colSpan={span}
          className="zt:h-(--zt-virtual-gap) zt:p-0"
          style={gap(height)}
        />
      </tr>
    </tbody>
  );
}
