import type { Command, Plugin } from "obsidian";
import { expect, it, vi } from "vitest";

import { registerQuickSwitch } from "./register";
import type { QuickSwitchDeps } from "./register";

const opened = vi.hoisted(() => vi.fn());
vi.mock("./modal", () => ({
  QuickSwitchModal: class {
    open = opened;
  },
}));

it("opens Quick Switch from its command", () => {
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

  commands[0]!.callback!();

  expect(opened).toHaveBeenCalledOnce();
});
