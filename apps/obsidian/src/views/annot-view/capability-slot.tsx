// The toolbar seat the Editing Capability affordance takes.
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

import { themeHook } from "@/lib/theme-hooks";
import { cn } from "@/lib/utils";

/**
 * What the Annotation View's toolbar renders between the mode button and the
 * collapse control. The view fills it with the Editing Capability affordance;
 * the seat itself names no content, so the toolbar keeps its shape whether or
 * not one is supplied.
 *
 * @see https://github.com/aidenlx/zotlit/issues/1147
 */
export const CapabilitySlotContext = createContext<ReactNode>(null);

/** Renders whatever the seat holds, and nothing while it holds nothing. */
export function CapabilitySlot() {
  const content = useContext(CapabilitySlotContext);
  return content === null ? null : (
    <div className={cn(themeHook.annotCapability, "zt:flex zt:items-center")}>
      {content}
    </div>
  );
}
