import { Fragment } from "react";
import type { ReactNode } from "react";

/** Keeps translated text and its named React slots in the translator's order. */
export function Message({
  text,
  slots,
}: {
  text: string;
  slots: Record<string, ReactNode>;
}) {
  let parts: ReactNode[] = [text];
  for (const [name, node] of Object.entries(slots)) {
    let occurrence = 0;
    parts = parts.flatMap<ReactNode>((part) => {
      if (typeof part !== "string") return [part];
      return part
        .split(`{${name}}`)
        .flatMap<ReactNode>((segment, index) =>
          index === 0
            ? [segment]
            : [
                <Fragment key={`${name}-${occurrence++}`}>{node}</Fragment>,
                segment,
              ],
        );
    });
  }
  return <>{parts}</>;
}
