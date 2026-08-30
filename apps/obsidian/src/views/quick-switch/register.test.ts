import type { Command, Plugin } from "obsidian";
import { expect, it } from "vitest";

import { registerQuickSwitch } from "./register";
import type { QuickSwitchDeps } from "./register";

it("registers the Quick Switch command with Profile switching owned by the note actions", () => {
  const commands: Command[] = [];
  registerQuickSwitch(
    {
      addCommand: (command: Command) => {
        commands.push(command);
        return command;
      },
    } as Pick<Plugin, "addCommand">,
    {} as QuickSwitchDeps,
  );
  expect(commands.map(({ id }) => id)).toEqual(["note-quick-switcher"]);
});
