import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useCustomFieldNames } from "./custom-fields";

afterEach(cleanup);

function Names(props: {
  read: (signal: AbortSignal) => Promise<readonly string[]>;
  reading?: boolean;
}) {
  const names = useCustomFieldNames(props.read, { reading: props.reading });
  return <output>{names.join(",")}</output>;
}

it("reads the names while reading, and stops the read when reading ends or the editor unmounts", async () => {
  const signals: AbortSignal[] = [];
  const answers: ((names: readonly string[]) => void)[] = [];
  const read = vi.fn((signal: AbortSignal) => {
    signals.push(signal);
    return new Promise<readonly string[]>((resolve) => answers.push(resolve));
  });
  const { container, rerender, unmount } = render(
    <Names read={read} reading={false} />,
  );
  expect(read).not.toHaveBeenCalled();

  await act(async () => rerender(<Names read={read} reading />));
  expect(read).toHaveBeenCalledOnce();
  await act(async () => answers[0]!(["Shelf"]));
  expect(container.textContent).toBe("Shelf");

  // A read that ends before its answer lands leaves the names as they were.
  await act(async () => rerender(<Names read={read} reading={false} />));
  expect(signals[0]!.aborted).toBe(true);
  await act(async () => rerender(<Names read={read} reading />));
  expect(read).toHaveBeenCalledTimes(2);
  await act(async () => unmount());
  expect(signals[1]!.aborted).toBe(true);
  await act(async () => answers[1]!(["Late"]));
  expect(container.textContent).toBe("");
});

it("offers none when the read fails", async () => {
  const { container } = render(
    <Names read={() => Promise.reject(new Error("no source"))} />,
  );
  await act(async () => {});
  expect(container.textContent).toBe("");
});
