import { expect, test } from "vitest";

import { modalAnswer } from "@/lib/modal-answer";

test("modalAnswer opens the modal before it returns, and answers once", async () => {
  let open = false;
  let settle: (value: boolean) => void = () => undefined;
  const modal = {
    closes: 0,
    close() {
      if (!open) return;
      open = false;
      modal.closes++;
      settle(false);
    },
  };
  const answer = modalAnswer<boolean>((next) => {
    settle = next;
    open = true;
    return modal;
  });
  expect(open).toBe(true);
  // A choice settles first, then the modal closes itself.
  settle(true);
  modal.close();
  await expect(answer).resolves.toBe(true);
  expect(modal.closes).toBe(1);
});
