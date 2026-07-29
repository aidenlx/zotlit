// SVGs imported with the `?svgr` query resolve to React components
// (see the turbopack.rules entry in next.config.ts).
declare module "*.svg?svgr" {
  import { type FC, type SVGProps } from "react";
  const Component: FC<SVGProps<SVGSVGElement>>;
  export default Component;
}
