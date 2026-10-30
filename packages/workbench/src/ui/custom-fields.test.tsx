import { act, cleanup, render } from "@testing-library/react";
import { Effect } from "effect";
import { afterEach, expect, it } from "vitest";

import { useCustomFieldNames } from "./custom-fields";
import { WorkbenchHostError } from "./host";
import { makeWorkbenchRunner } from "./run";

afterEach(cleanup);

const runner = makeWorkbenchRunner();

function Names(props: {
  read: Effect.Effect<readonly string[], unknown>;
  reading?: boolean;
}) {
  const names = useCustomFieldNames(props.read, {
    run: runner.run,
    reading: props.reading,
  });
  return <output>{names.join(",")}</output>;
}

/** A read the test answers, which records whether it was interrupted. */
function heldRead() {
  const reads: {
    answer: (names: readonly string[]) => void;
    interrupted: boolean;
  }[] = [];
  const read = Effect.callback<readonly string[]>((resume) => {
    const entry = {
      answer: (names: readonly string[]) => resume(Effect.succeed(names)),
      interrupted: false,
    };
    reads.push(entry);
    return Effect.sync(() => {
      entry.interrupted = true;
    });
  });
  return { read, reads };
}

it("reads the names while reading, and interrupts the read when reading ends or the editor unmounts", async () => {
  const { read, reads } = heldRead();
  const { container, rerender, unmount } = render(
    <Names read={read} reading={false} />,
  );
  expect(reads).toHaveLength(0);

  await act(async () => rerender(<Names read={read} reading />));
  expect(reads).toHaveLength(1);
  await act(async () => reads[0]!.answer(["Shelf"]));
  expect(container.textContent).toBe("Shelf");

  // A read that ends before its answer lands leaves the names as they were.
  await act(async () => rerender(<Names read={read} reading={false} />));
  await act(async () => rerender(<Names read={read} reading />));
  expect(reads).toHaveLength(2);
  await act(async () => rerender(<Names read={read} reading={false} />));
  expect(reads[1]!.interrupted).toBe(true);
  await act(async () => rerender(<Names read={read} reading />));
  expect(reads).toHaveLength(3);
  await act(async () => unmount());
  expect(reads[2]!.interrupted).toBe(true);
});

it("offers none when the read fails", async () => {
  const { container } = render(
    <Names
      read={Effect.fail(
        new WorkbenchHostError({ cause: new Error("no source") }),
      )}
    />,
  );
  await act(async () => {});
  expect(container.textContent).toBe("");
});
