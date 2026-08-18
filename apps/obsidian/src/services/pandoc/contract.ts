// The version the Native Pandoc Workflow's CLI Contract answers with.

/**
 * The wire format of the `zotlit:pandoc-*`, `zotlit:resolve`, and `zotlit:csl`
 * commands, versioned on its own (ADR 0026). It answers 2 since `zotlit:csl`
 * and the `zotlit-csl` document property joined the contract.
 *
 * It stands apart from the handlers that report it, so the integration files
 * reach a command surface without every command reaching the files.
 */
export const CONTRACT_VERSION = 2;
