import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it } from "vitest";

import { useCustomFieldNames } from "./custom-fields";
import { mount } from "./test-host";

afterEach(cleanup);

function Names({ revision }: { revision: string }) {
  const names = useCustomFieldNames(revision);
  return <output>{names.join(",")}</output>;
}

it("reads the names for each revision, and interrupts the read a new revision or the unmount leaves", async () => {
  using mounted = mount(<Names revision="1" />);
  const { host } = mounted;
  const wrap = (children: ReactNode) => mounted.wrap(children);
  host.hold = true;
  const { container, rerender, unmount } = render(mounted.ui);
  expect(host.held.map(({ kind }) => kind)).toEqual(["customFields"]);
  await act(async () => host.held[0]!.answer(["Shelf"]));
  expect(container.textContent).toBe("Shelf");

  rerender(wrap(<Names revision="2" />));
  expect(host.held).toHaveLength(2);
  rerender(wrap(<Names revision="3" />));
  await host.held[1]!.interruption;
  expect(host.held).toHaveLength(3);
  act(() => unmount());
  await host.held[2]!.interruption;
});

it("offers none when the read fails", async () => {
  using mounted = mount(<Names revision="1" />);
  mounted.host.hold = true;
  const { container } = render(mounted.ui);
  await act(async () => mounted.host.held[0]!.fail(new Error("no source")));
  expect(container.textContent).toBe("");
});
