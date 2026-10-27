import { expect, it, vi } from "vitest";

import * as toast from "./toast";
import { UserCancelled } from "./user-cancel";

// #1824: the user's cancel of a loading notice is not a failure to report.
it("reports nothing when the user cancels the task", async () => {
  const error = vi.fn(() => undefined);
  await toast.promise(Promise.reject(new UserCancelled()), { error });
  await Promise.resolve();
  expect(error).not.toHaveBeenCalled();
});

it("reports a failure of the task", async () => {
  const error = vi.fn(() => undefined);
  await toast.promise(Promise.reject(new Error("disk full")), { error });
  await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
});
