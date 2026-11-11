// Each job's lead replica: the window, the feature its caption names, and the
// features it shows working (a filled dot in the job's feature list).

import type { ComponentType } from "react";

import type { JobId } from "@/components/landing/jobs";

import CiteReplica from "./cite";
import ConnectReplica from "./connect";
import ConnectionsReplica from "./connections";
import CustomiseReplica from "./customise";
import ExportReplica from "./export";
import FindReplica from "./find";
import NotesReplica from "./notes";
import ReadReplica from "./read";

export interface Replica {
  Component: ComponentType;
  /** The feature the caption names: "Shown: …". */
  feature: string;
  shows: readonly string[];
}

export const REPLICAS: Record<JobId, Replica> = {
  connect: {
    Component: ConnectReplica,
    feature: "direct",
    shows: ["direct", "libraries"],
  },
  find: {
    Component: FindReplica,
    feature: "library",
    shows: ["library", "readingCard"],
  },
  read: {
    Component: ReadReplica,
    feature: "pdf",
    shows: ["pdf", "annotationView"],
  },
  notes: {
    Component: NotesReplica,
    feature: "litNote",
    shows: ["litNote", "switcher"],
  },
  cite: {
    Component: CiteReplica,
    feature: "livePreview",
    shows: ["suggester", "livePreview"],
  },
  connections: {
    Component: ConnectionsReplica,
    feature: "references",
    shows: ["references"],
  },
  export: {
    Component: ExportReplica,
    feature: "exportWord",
    shows: ["exportWord"],
  },
  customise: {
    Component: CustomiseReplica,
    feature: "workbench",
    shows: ["workbench"],
  },
};
