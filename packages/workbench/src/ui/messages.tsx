// Each tree reads the platform's message functions at the point of use.
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

import type { WorkbenchMessages } from "./generated/messages";

const MessagesContext = createContext<WorkbenchMessages | null>(null);

export function WorkbenchMessagesProvider({
  messages,
  children,
}: {
  messages: WorkbenchMessages;
  children?: ReactNode;
}) {
  return (
    <MessagesContext.Provider value={messages}>
      {children}
    </MessagesContext.Provider>
  );
}

export function useWorkbenchMessages(): WorkbenchMessages {
  const messages = useContext(MessagesContext);
  if (messages === null)
    throw new Error("The Workbench UI needs host messages above it.");
  return messages;
}

/** Message keys that accept no inputs, for static label maps. */
export type WorkbenchMessageLabel = {
  [K in keyof WorkbenchMessages]: WorkbenchMessages[K] extends () => string
    ? K
    : never;
}[keyof WorkbenchMessages];
