# Legacy conversion preserves sources through repair and separates cleanup

The v2.1 upgrade keeps the original template configuration active while the user reviews or repairs an inactive Conversion Copy. The existing Literature Note template migration service owns preparation, verification, acceptance, activation, and cleanup. Copies include legacy sources and the field list, so a layout that fails before Profile synthesis still has a repair path. Inactive vault files preserve unfinished work across closure and restart, with resume and discard actions.

Verification compares selected template outputs against the original configuration using one Item, an optional Annotation, and a one-item Citation. The create baseline keeps its existing trailing-line-break normalization. Managed Frontmatter receives evaluation checks. Review distinguishes matching output, changed output, and unavailable original output. Valid repairs with intentional output changes require explicit acceptance, recorded separately from matching output. The original configuration is checked again before activation; changes require a new review.

The native Template Workbench retains the correct Profile, Citation, and Shared Partial editing and preview behavior for inactive copies. All repair operations, including partial operations, preserve isolation. Problems retains explanation, suggestions, navigation, and reporting under ADR 0056; conversion actions remain in the conversion workflow.

Conversion builds and verifies documents before active writes, preserves destination-conflict refusal, and rolls back document-creation failures. Accepted activation and old-file cleanup are separate durable outcomes. Cleanup failure leaves accepted documents active, records retained files, and supports retry after restart.

Following ADR 0036, postponed conversion keeps one automatic Welcome invitation, a compact settings entry, default legacy rendering, and existing Profile gates. The frontmatter-only Customize route remains available. Existing Literature Note and Imported Note stamps remain unchanged; an absent stamp continues to mean Default.

The implementation contract is [spec #1095](https://github.com/aidenlx/zotlit/issues/1095).
