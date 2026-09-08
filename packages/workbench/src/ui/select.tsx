// Native selection semantics; the host supplies its control surface and glyph.
import type { ComponentProps } from "react";

import { useIcon, useParts } from "./theme";

export function WorkbenchSelect({
  className,
  ...props
}: Omit<ComponentProps<"select">, "style" | "size">) {
  const part = useParts("select");
  const icon = useIcon();
  return (
    <div {...part("wrapper")}>
      <select
        {...part("select")}
        {...props}
        className={
          [part("select").className, className].filter(Boolean).join(" ") ||
          undefined
        }
      />
      <span aria-hidden {...part("icon")}>
        {icon("chevron-down")}
      </span>
    </div>
  );
}

export function WorkbenchOption(
  props: Omit<ComponentProps<"option">, "className" | "style">,
) {
  const part = useParts("select");
  return <option {...part("option")} {...props} />;
}
