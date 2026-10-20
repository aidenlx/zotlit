import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { MatchExpressionInput } from "./match.expression";

afterEach(cleanup);

it("colors a method name with the function hook and its receiver with the property hook", () => {
  const { container } = render(
    <MatchExpressionInput value="title.lower()" onChange={() => {}} />,
  );
  const tokens = (hook: string) =>
    [...container.querySelectorAll(`.${hook}`)].map((node) => node.textContent);
  expect(tokens("zt-template-filter")).toEqual(["lower"]);
  expect(tokens("zt-template-property")).toEqual(["title"]);
});
