// @vitest-environment happy-dom
import { expect, it } from "vitest";

import { zotlitMarkSvg } from "./icon";

it("draws the 16-unit mark's two paths in one ink, scaled into the 100-unit icon box", () => {
  const svg = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${zotlitMarkSvg()}</svg>`,
    "image/svg+xml",
  ).documentElement;
  const group = svg.firstElementChild!;
  expect(group.getAttribute("transform")).toBe("scale(6.25)");
  expect(group.getAttribute("fill")).toBe("currentColor");
  const paths = [...group.querySelectorAll("path")];
  expect(paths).toHaveLength(2);
  expect(paths.every((path) => !path.hasAttribute("fill"))).toBe(true);
});
