// The toolbar seat the Editing Capability affordance takes.
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

/**
 * What the Annotation View's toolbar renders between the mode button and the
 * collapse control. It is empty here: the Editing Capability affordance that
 * fills it arrives with the capability itself, and the seat exists now so the
 * toolbar's shape is settled and nothing has to move when it does.
 *
 * @see https://github.com/aidenlx/zotlit/issues/1147
 */
export const CapabilitySlotContext = createContext<ReactNode>(null);

/** Renders whatever the seat holds, and nothing while it holds nothing. */
export function CapabilitySlot() {
  const content = useContext(CapabilitySlotContext);
  return content === null ? null : (
    <div className="zt-annot-capability zt:flex zt:items-center">{content}</div>
  );
}
