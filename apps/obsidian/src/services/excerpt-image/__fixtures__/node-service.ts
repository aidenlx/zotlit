// Node tests use the production platform filesystem.
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";

import type { ExcerptDeps } from "@/services/excerpt-image/service";
import { ExcerptImageFixture } from "./service";

export class NodeExcerptImageFixture extends ExcerptImageFixture {
  constructor(deps: ExcerptDeps = {}, fs = NodeFileSystem.layer) {
    super(deps, fs);
  }
}
