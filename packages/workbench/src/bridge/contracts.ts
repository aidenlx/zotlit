// Wire contract for the browser Workbench and one approved Local Bridge.

import * as v from "valibot";

import type { ItemSnapshot } from "@/snapshot/types";

export const BRIDGE_VERSION = 1;
export const LOCAL_BRIDGE_ORIGIN = "http://127.0.0.1:23120";

export const BRIDGE_CAPABILITIES = [
  "template-schema:read",
  "selected-item:read",
  "selected-profile:read",
  "selected-profile:save",
  "template-dependencies:read",
  "citation-styles:list",
  "selected-citation-style:read",
] as const;
export const bridgeCapabilitySchema = v.picklist(BRIDGE_CAPABILITIES);
export type BridgeCapability = (typeof BRIDGE_CAPABILITIES)[number];

export interface BridgeCompatibility {
  readonly bridgeVersion: number;
  readonly templateDataContractVersion: number;
}

export const bridgeInstallationSchema = v.object({
  id: v.string(),
  vault: v.string(),
  zoteroSourceId: v.string(),
});
export type BridgeInstallation = v.InferOutput<typeof bridgeInstallationSchema>;

export const selectedItemIdentitySchema = v.object({
  key: v.string(),
  title: v.nullable(v.string()),
});

export const profileIdentitySchema = v.object({
  id: v.string(),
  name: v.string(),
});
export type ProfileIdentity = v.InferOutput<typeof profileIdentitySchema>;

/**
 * The vault's own value for each sparse binding a Profile may override, so a
 * connected page shows the default in effect there rather than the plugin's
 * built-in one, and Override writes that same value.
 */
export const profileBindingDefaultsSchema = v.object({
  folder: v.string(),
  citationStyle: v.nullable(v.string()),
  importFolder: v.string(),
  importColoredHighlights: v.boolean(),
  importAnnotationsAsTemplate: v.boolean(),
});
export type ProfileBindingDefaults = v.InferOutput<
  typeof profileBindingDefaultsSchema
>;

export const connectionGrantSchema = v.object({
  credential: v.string(),
  installation: bridgeInstallationSchema,
  pluginVersion: v.string(),
  bridgeVersion: v.number(),
  templateDataContractVersion: v.number(),
  capabilities: v.array(bridgeCapabilitySchema),
  selectedItem: selectedItemIdentitySchema,
  selectedProfile: profileIdentitySchema,
  profileDefaults: profileBindingDefaultsSchema,
});
export type ConnectionGrant = v.InferOutput<typeof connectionGrantSchema>;

/**
 * What the bridge running now says about a kept credential: the grant as it
 * stands, without the credential the page already holds.
 */
export const sessionResumeResponseSchema = v.omit(connectionGrantSchema, [
  "credential",
]);

export const codeBootstrapRequestSchema = v.object({
  code: v.string(),
});

export const loopbackBootstrapRequestSchema = v.object({});

export const loopbackBootstrapResponseSchema = v.variant("state", [
  v.object({ state: v.literal("pending") }),
  v.object({
    state: v.literal("approved"),
    connection: connectionGrantSchema,
  }),
]);

export const disconnectRequestSchema = v.object({});
export const disconnectResponseSchema = v.object({});
export const selectedItemRequestSchema = v.object({});

const jsonObjectSchema = v.record(v.string(), v.unknown());

export const templateSchemaResponseSchema = v.object({
  note: jsonObjectSchema,
  annotation: jsonObjectSchema,
  filename: jsonObjectSchema,
});
export type TemplateSchemaResponse = v.InferOutput<
  typeof templateSchemaResponseSchema
>;

const snapshotLibrarySelectorSchema = v.variant("type", [
  v.object({ type: v.literal("personal") }),
  v.object({ type: v.literal("group"), groupID: v.number() }),
]);

const snapshotProvenanceSchema = v.variant("kind", [
  v.object({
    kind: v.literal("sample"),
    id: v.string(),
    source: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("connected"),
    installationId: v.string(),
    vault: v.string(),
  }),
]);

const templatePathSchema = v.array(v.union([v.string(), v.number()]));
const snapshotRootDescriptorsSchema = v.object({
  stringCoercions: v.array(
    v.object({ path: templatePathSchema, value: v.string() }),
  ),
  temporalValues: v.array(
    v.object({
      path: templatePathSchema,
      type: v.picklist([
        "Temporal.Instant",
        "Temporal.PlainDate",
        "Temporal.PlainYearMonth",
      ]),
    }),
  ),
  graphReferences: v.array(
    v.object({ path: templatePathSchema, target: templatePathSchema }),
  ),
});

export const itemSnapshotSchema: v.GenericSchema<ItemSnapshot> = v.object({
  contractVersion: v.number(),
  revision: v.string(),
  item: v.object({
    key: v.string(),
    indexedKey: v.string(),
    itemType: v.string(),
    title: v.nullable(v.string()),
    library: snapshotLibrarySelectorSchema,
  }),
  provenance: snapshotProvenanceSchema,
  roots: v.object({
    note: jsonObjectSchema,
    filename: jsonObjectSchema,
    annotations: v.array(jsonObjectSchema),
  }),
  descriptors: v.object({
    note: snapshotRootDescriptorsSchema,
    filename: snapshotRootDescriptorsSchema,
    annotations: v.array(snapshotRootDescriptorsSchema),
  }),
  unavailable: v.array(v.object({ path: v.string(), reason: v.string() })),
});

export const profileDocumentSchema = v.variant("state", [
  v.object({
    state: v.literal("present"),
    reference: v.string(),
    revision: v.string(),
  }),
  v.object({
    state: v.literal("built-in-absent"),
    reference: v.string(),
  }),
]);

export const selectedProfileResponseSchema = v.object({
  profile: profileIdentitySchema,
  source: v.string(),
  document: profileDocumentSchema,
});
export type SelectedProfileResponse = v.InferOutput<
  typeof selectedProfileResponseSchema
>;

export const expectedProfileRevisionSchema = v.variant("state", [
  v.object({ state: v.literal("absent") }),
  v.object({
    state: v.literal("revision"),
    revision: v.string(),
  }),
]);

export const saveSelectedProfileRequestSchema = v.object({
  reference: v.string(),
  expected: expectedProfileRevisionSchema,
  source: v.string(),
});
export type SaveSelectedProfileRequest = v.InferOutput<
  typeof saveSelectedProfileRequestSchema
>;

export const saveSelectedProfileResponseSchema = v.variant("state", [
  v.object({ state: v.literal("saved"), revision: v.string() }),
  v.object({
    state: v.literal("refused"),
    reason: v.picklist([
      "revision-conflict",
      "document-exists",
      "invalid-source",
      "unsupported-profile",
    ]),
    currentRevision: v.optional(v.string()),
  }),
]);
export type SaveSelectedProfileResponse = v.InferOutput<
  typeof saveSelectedProfileResponseSchema
>;

export const templateDependencySchema = v.object({
  name: v.string(),
  language: v.picklist(["liquid", "eta"]),
  source: v.string(),
});

export const templateDependencyDiagnosticSchema = v.object({
  code: v.picklist(["missing-dependency", "unsupported-dependency"]),
  message: v.string(),
});

/**
 * The document the bundle answers. A Local Bridge resolves the partials this
 * exact draft calls, so a preview never runs against the vault's saved Profile.
 */
export const templateDependenciesRequestSchema = v.object({
  source: v.string(),
});
export type TemplateDependenciesRequest = v.InferOutput<
  typeof templateDependenciesRequestSchema
>;

export const templateDependenciesResponseSchema = v.object({
  templates: v.array(templateDependencySchema),
  diagnostics: v.array(templateDependencyDiagnosticSchema),
});
export type TemplateDependenciesResponse = v.InferOutput<
  typeof templateDependenciesResponseSchema
>;

export const installedCitationStyleSchema = v.object({
  id: v.string(),
  title: v.string(),
});
export const citationStylesResponseSchema = v.array(
  installedCitationStyleSchema,
);
export type InstalledCitationStyle = v.InferOutput<
  typeof installedCitationStyleSchema
>;

export const selectedCitationStyleRequestSchema = v.object({
  styleId: v.nullable(v.string()),
  locale: v.optional(v.nullable(v.string())),
});
export type SelectedCitationStyleRequest = v.InferOutput<
  typeof selectedCitationStyleRequestSchema
>;

export const selectedCitationStyleResponseSchema = v.variant("kind", [
  v.object({
    kind: v.literal("default"),
    locale: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("installed"),
    styleId: v.string(),
    parentId: v.optional(v.string()),
    locale: v.optional(v.string()),
    xml: v.string(),
  }),
  v.object({
    kind: v.literal("failed"),
    styleId: v.string(),
    parentId: v.optional(v.string()),
    reason: v.picklist([
      "style-missing",
      "parent-missing",
      "unreadable",
      "invalid",
    ]),
  }),
]);
export type SelectedCitationStyleResponse = v.InferOutput<
  typeof selectedCitationStyleResponseSchema
>;

export const bridgeErrorResponseSchema = v.object({
  error: v.object({ code: v.string(), message: v.string() }),
});

export const LOCAL_BRIDGE_PATHS = {
  codeBootstrap: "/v1/bootstrap/code",
  loopbackBootstrap: "/v1/bootstrap/probe",
  disconnect: "/v1/session/disconnect",
  resumeSession: "/v1/session/resume",
  templateSchema: "/v1/template/schema",
  selectedItem: "/v1/item/selected",
  selectedProfile: "/v1/profile/selected",
  saveSelectedProfile: "/v1/profile/selected/save",
  templateDependencies: "/v1/template/dependencies",
  citationStyles: "/v1/citation-styles",
  selectedCitationStyle: "/v1/citation-style/selected",
} as const;
