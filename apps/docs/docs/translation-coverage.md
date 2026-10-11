# Bilingual translation coverage

Snapshot: 2026-10-11, integration commit `eed6e179` on `poc/docs-i18n` for [PR #1446](https://github.com/aidenlx/zotlit/pull/1446).

This report records the English and Simplified Chinese source pairs, translation choices, and known limits. It covers tracked source files. Temporary browser fixtures are excluded. [The editing guide](i18n.md) explains the file layout. [The verification report](i18n-verification.md) owns the final build, HTTP, browser, and review results.

## Result and scope

- All **88 English MDX sources have 88 Chinese siblings**: 85 pages and 3 included partials. The completion audit covers frontmatter, headings, authored prose, tables, callouts, and component labels in each pair.
- **65 Chinese files were completed or revised**, and **23 already-translated files were reviewed and retained** during the completion pass. That pass reports no remaining untranslated authored prose. These are source-review results, not a count of Chinese characters or a claim that every translation is correct.
- All **7 navigation metadata pairs** are covered: 7 translated titles, including the root search breadcrumb.
- Each root catalog has **157 `docs_*` keys**: 110 prior site messages plus 47 native UI messages. Five values retain intentional product or example text. All **1,910 non-docs top-level values**, including nested values, match the original `a635872e` baseline in each locale.
- The root-backed Fumadocs adapter supplies **51 registry keys**: 50 context-qualified keys plus `displayName`. It reuses 47 root messages through the generated facade. The app-local dictionary files have been removed.
- The Chinese template-data page has **18 generated `ContractTable` sections** whose generated descriptions and table copy remain English. Its authored surrounding prose and both handwritten partials are translated.

**Review status is source-specific.** Independent semantic re-review at `2ee71999` covers all 88 MDX pairs, the 7 metadata pairs, and the original 110 docs catalog values. It closed all 39 earlier findings: 15 P2 and 24 P3. That correction pass changed 29 MDX files and `docs_redirect_original_page` while preserving code, imports, UI calls, explicit IDs, links, and includes.

The subsequent Standards pass at `2233815f` fixes six documented-standard findings and one duplication finding. It changes 22 Chinese MDX files for approved terminology and message-backed UI labels, moves native UI copy to the root catalogs, and prerenders native Chinese editions. Final independent Standards and Spec reviews both report zero open findings at `eed6e179`. The language-diff review covers all 22 MDX changes and 47 native messages without a new meaning or interpolation issue. It found one changed generated heading ID; `eed6e179` restores it explicitly. Independent language re-review at `eed6e179` closes that finding and confirms all 39 prior findings remain closed.

At `2233815f`, 347 docs tests in 42 files, both typechecks, and all 176 MDX compilations pass. Root lint has zero errors and five existing warnings; formatting passes. The normal production build emits 533 routes, including 90 Chinese HTML and 174 Chinese Markdown assets. The serialized HTTP matrix passes 7,946 checks across 1,198 requests, including 264 native-asset checks. Native Chinese UI/browser checks passed except for the root search breadcrumb at that source. Commit `a1d3d7d1` supplies the root title “文档” and regression checks; 349 docs tests, both typechecks, lint, and formatting pass. A normal fixture build at `a1d3d7d1` emits 536 routes; 8,013 HTTP checks over 1,208 requests and browser fallback/search-breadcrumb checks pass. The fixture is removed. The final clean build and browser pass after `eed6e179` remain pending. All 896 compiled heading IDs across the 88 Chinese files match the reviewed `2ee71999` source after the explicit-ID correction. See [the verification report](i18n-verification.md) for exact source pins and limits. Remote CI, publication, and deployment are not established by these local checks.

## Source reconciliation

Both source PRs contribute real translations. They are divergent sources; importing one does not include the other.

| Source | Pinned revision | Role |
| --- | --- | --- |
| [PR #1447](https://github.com/aidenlx/zotlit/pull/1447) | `675c8b3265c8e2d20cb424180f7fe00864a189e4` | Complementary introduction/tutorial wording, the intro navigation title, missing template-data sections and partials, site description, and example quote. |
| [PR #1448](https://github.com/aidenlx/zotlit/pull/1448) | `f8bd34ec1be87cc57efa6b3e2016ac886ce5942e` | Main translated foundation for the other pages, metadata, and UI copy. |
| Integration completion | `f042e2fa`, `565b551e`, `05a844c7` | Complete remaining authored English, reconcile both sources, repair MDX syntax, retain stable headings, and correct meaning against the English sibling. |
| Native UI registry repair | `10e151db` | Map translated values to the installed 51-key registry; cover both displayed and accessible labels. |
| Semantic corrections | `2ee71999` | Correct all 39 independent findings in 29 MDX files and one docs message; independent re-review passed. |
| Standards corrections | `2233815f` | Use root-backed native UI messages, prerender native Chinese editions, update terminology and message-backed labels in 22 MDX files, and correct code conventions. Standards findings closed at `6ff764e2`. |
| Root breadcrumb | `a1d3d7d1` | Add the Chinese root title “文档”, a native page-tree regression, and HTTP breadcrumb assertions. |
| Final heading preservation | `eed6e179` | Restore the prior Chinese citation-key migration heading ID explicitly; all 896 compiled Chinese heading IDs match `2ee71999`. |

The per-file source column records the chosen wording, not exclusive authorship of a whole file. Shared source text is retained. Where sources differ, the English sibling determines the meaning. MDX repairs preserve component contracts, message bindings, examples, and link targets. The completion pass keeps 1447 contributions in 13 MDX files, one metadata file, and two docs catalog values. The source commits remain the durable comparison points.

## Per-file MDX audit

Paths below are relative to `apps/docs/content/`. Each row names the Chinese file and its 12-character Git blob ID at `eed6e179`; remove `.zh-CN` for its English source at the same commit. A filename beginning with `_` is an included partial, not a standalone page.

- **Completed**: the completion pass translated remaining authored text or revised existing copy against English.
- **Retained**: that pass reviewed already-translated authored copy and kept it.
- Both states report no remaining authored English gap in the scoped completion audit. A **corrected** suffix identifies the 29 files changed by the later `2ee71999` correction pass. That earlier independent semantic re-review passed. A **standards update** suffix marks the 22 later files changed at `2233815f`; their language-diff review found one generated-anchor change, corrected and independently closed at `eed6e179`.
- All rows retain technical English where required: product names, identifiers, commands, paths, code, exact diagnostics, host-product control names, and worked examples. The last column records important file-specific decisions in addition to those shared rules.

### Introduction: 5 pairs

| Chinese file | Chinese blob | Chosen source | Completion and correction | Decision or exception |
| --- | --- | --- | --- | --- |
| `docs/(intro)/credits.zh-CN.mdx` | `56c9e423ee4b` | 1448 + 1447 | Completed | 1447 ordering explanation and acknowledgement of annotation interactions. |
| `docs/(intro)/index.zh-CN.mdx` | `ba35335c7da6` | 1448 + 1447 | Completed | Migration question and precise wording that template adaptation is required. |
| `docs/(intro)/install-companion.zh-CN.mdx` | `edc1e10a1cc8` | 1448 + 1447 | Completed | Bilingual external UI labels from #1447 in both release tabs; keep #1448 translated tab labels. |
| `docs/(intro)/install-skill.zh-CN.mdx` | `ffb48c536637` | 1448 + 1447 | Completed | Explicit single-vault scope and precise symlink terminology. |
| `docs/(intro)/install-zotlit.zh-CN.mdx` | `24241d5d3df4` | 1448 + 1447 | Completed | Concise action label; keep actual version requirements unchanged. |

### Concepts: 10 pairs

| Chinese file | Chinese blob | Chosen source | Completion and correction | Decision or exception |
| --- | --- | --- | --- | --- |
| `docs/concepts/excerpt-images.zh-CN.mdx` | `9ecfab8ccd33` | 1448 | Retained; corrected | Shared technical-English rules apply. |
| `docs/concepts/how-citekey-links-work.zh-CN.mdx` | `339412481763` | 1448 | Completed; standards update | Shared technical-English rules apply. |
| `docs/concepts/how-templates-work.zh-CN.mdx` | `43957904d6c6` | 1448 | Completed | Shared technical-English rules apply. |
| `docs/concepts/how-zotlit-connects-to-zotero.zh-CN.mdx` | `aa9e39f7f8fd` | 1448 | Completed; standards update | Shared technical-English rules apply. |
| `docs/concepts/index.zh-CN.mdx` | `842478016e37` | 1448 | Retained | Shared technical-English rules apply. |
| `docs/concepts/javascript-templates.zh-CN.mdx` | `9500959df2d3` | 1448 | Completed | Shared technical-English rules apply. |
| `docs/concepts/literature-notes-and-the-managed-region.zh-CN.mdx` | `c44e12a62b47` | 1448 | Completed | Shared technical-English rules apply. |
| `docs/concepts/profiles.zh-CN.mdx` | `8c384d385f7e` | 1448 | Completed | Shared technical-English rules apply. |
| `docs/concepts/template-workbench-view.zh-CN.mdx` | `e54e4da20d8d` | 1448 | Completed | Shared technical-English rules apply. |
| `docs/concepts/template-workbench.zh-CN.mdx` | `e585db9f8f4e` | 1448 | Completed | Shared technical-English rules apply. |

### How-to guides: 30 pairs

| Chinese file | Chinese blob | Chosen source | Completion and correction | Decision or exception |
| --- | --- | --- | --- | --- |
| `docs/how-to/_security-prompt-callout.zh-CN.mdx` | `6f0369c38fb4` | 1448 | Retained | Shared technical-English rules apply. |
| `docs/how-to/collect-debug-logs.zh-CN.mdx` | `d3d564e33624` | 1448 | Completed; corrected | Exact host-product controls, log levels, placeholders, and filenames remain unchanged. |
| `docs/how-to/configure-frontmatter-properties.zh-CN.mdx` | `3c7e2641bae6` | 1448 | Completed | Shared technical-English rules apply. |
| `docs/how-to/create-and-open-notes.zh-CN.mdx` | `13fbc774fb48` | 1448 | Completed | Shared technical-English rules apply. |
| `docs/how-to/customize-a-template.zh-CN.mdx` | `f5f12f62ddb0` | 1448 | Completed | Shared technical-English rules apply. |
| `docs/how-to/edit-a-profile-as-markdown.zh-CN.mdx` | `8ca7a8bc2bc5` | 1448 | Completed; corrected | Frontmatter, YAML, manifest, and ID remain technical terms. |
| `docs/how-to/edit-pdf-annotations.zh-CN.mdx` | `98ab4d417220` | 1448 | Completed; standards update | Retains the warning that avoiding overlapping edits does not guarantee safety. |
| `docs/how-to/enable-javascript-templates.zh-CN.mdx` | `934f8821da72` | 1448 | Completed | Shared technical-English rules apply. |
| `docs/how-to/explore-citations-in-graph.zh-CN.mdx` | `4d34b62c6ec1` | 1448 | Completed; corrected | Exact Obsidian graph controls, commands, colors, and property names remain unchanged. |
| `docs/how-to/explore-template-data.zh-CN.mdx` | `c04248c5f12a` | 1448 | Completed; corrected | Localized partial include; API fields and template syntax stay exact. |
| `docs/how-to/export-note-with-citations.zh-CN.mdx` | `d656b3f808d0` | 1448 | Completed; corrected | Exact Zotero control path and API permission label remain unchanged. |
| `docs/how-to/export-with-native-pandoc.zh-CN.mdx` | `e45df3141086` | 1448 | Completed; corrected | CLI, YAML, Markdown, terminal output, and error codes stay exact. |
| `docs/how-to/fix-stale-data.zh-CN.mdx` | `32fb471adecc` | 1448 | Completed; corrected | Full copy applies on each refresh; removes an unsupported freshness guarantee. |
| `docs/how-to/import-zotero-notes.zh-CN.mdx` | `4d41e1011e0c` | 1448 | Completed; corrected | Localized partial include; fenced examples and My Library stay exact. |
| `docs/how-to/index.zh-CN.mdx` | `2c31239f87be` | 1448 | Retained | Shared technical-English rules apply. |
| `docs/how-to/insert-citations.zh-CN.mdx` | `cfd8e08e09b5` | 1448 | Completed; standards update | Quoted notice matches the existing Chinese plugin catalog; citation examples stay exact. |
| `docs/how-to/keep-notes-updated.zh-CN.mdx` | `6d6d92d58a7d` | 1448 | Completed | Shared technical-English rules apply. |
| `docs/how-to/migrate-from-2.1-templates.zh-CN.mdx` | `8f6ff2530fa4` | 1448 | Completed; corrected | Shared technical-English rules apply. |
| `docs/how-to/migrate-from-pandoc-reference-list.zh-CN.mdx` | `1878ba1b672c` | 1448 | Completed; corrected; standards update | Explicit prior Chinese heading ID restored at `eed6e179`; technical identifiers remain exact. |
| `docs/how-to/migrate-from-v1.zh-CN.mdx` | `246865d74d7d` | 1448 | Completed | Shared technical-English rules apply. |
| `docs/how-to/migrate-from-zotero-integration.zh-CN.mdx` | `6b811f3b2d38` | 1448 | Completed; corrected | Shared technical-English rules apply. |
| `docs/how-to/migrate-v1-eta-templates.zh-CN.mdx` | `c910e1fba570` | 1448 | Completed | Shared technical-English rules apply. |
| `docs/how-to/open-pdf-in-obsidian.zh-CN.mdx` | `af1708063445` | 1448 | Completed; corrected; standards update | Shared technical-English rules apply. |
| `docs/how-to/review-copy-troubleshoot-references.zh-CN.mdx` | `443e03bc8f57` | 1448 | Completed; standards update | Shared technical-English rules apply. |
| `docs/how-to/set-up-live-updates.zh-CN.mdx` | `f17bb2ce8053` | 1448 | Completed; corrected; standards update | Shared technical-English rules apply. |
| `docs/how-to/suppress-zotero-security-prompt.zh-CN.mdx` | `c5b0b329ab8c` | 1448 | Completed | Shared technical-English rules apply. |
| `docs/how-to/sync-across-devices.zh-CN.mdx` | `05dcdbdfca78` | 1448 | Completed | Shared technical-English rules apply. |
| `docs/how-to/update-obsidian-installer.zh-CN.mdx` | `889f6324f060` | 1448 | Retained | Shared technical-English rules apply. |
| `docs/how-to/use-annotation-view.zh-CN.mdx` | `7232aee74fd9` | 1448 | Completed; corrected; standards update | Shared technical-English rules apply. |
| `docs/how-to/use-different-templates.zh-CN.mdx` | `007dfb87acf1` | 1448 | Completed | Shared technical-English rules apply. |

### Tutorials: 5 pairs

| Chinese file | Chinese blob | Chosen source | Completion and correction | Decision or exception |
| --- | --- | --- | --- | --- |
| `docs/tutorial/customize-template.zh-CN.mdx` | `dbb9dc04b062` | 1448 + 1447 | Completed | Clarification that notes change on their next update, not on saving the template. |
| `docs/tutorial/first-note.zh-CN.mdx` | `7daa81ed20ce` | 1448 + 1447 | Completed | Clarification that this is a ZotLit prerequisite, not a claim that installation upgraded Obsidian. |
| `docs/tutorial/index.zh-CN.mdx` | `515c9aadf744` | 1448 + 1447 | Completed | Explicit built-in export distinction. |
| `docs/tutorial/pandoc-citation-workflow.zh-CN.mdx` | `061ad2c2d4b4` | 1448 + 1447 | Completed; corrected | Explicit built-in export distinction and paired filenames for recovery. |
| `docs/tutorial/write-and-export-cited-note.zh-CN.mdx` | `b26e0686d22e` | 1448 + 1447 | Completed | Correct modifier-key term and concrete Markdown portability label. |

### Reference: 16 pairs

| Chinese file | Chinese blob | Chosen source | Completion and correction | Decision or exception |
| --- | --- | --- | --- | --- |
| `docs/reference/commands.zh-CN.mdx` | `13cc53c5e462` | 1448 | Completed; standards update | Shared technical-English rules apply. |
| `docs/reference/index.zh-CN.mdx` | `3498ce275691` | 1448 | Retained | Shared technical-English rules apply. |
| `docs/reference/protocol-links.zh-CN.mdx` | `8e2a1d1cb513` | 1448 | Completed | Action-name headings remain exact protocol identifiers. |
| `docs/reference/settings.zh-CN.mdx` | `d33c4490b6b5` | 1448 | Completed; standards update | Shared technical-English rules apply. |
| `docs/reference/template-workbench-cli.zh-CN.mdx` | `59718a49cb48` | 1448 | Completed | Shared technical-English rules apply. |
| `docs/reference/templates/_field-aliases.zh-CN.mdx` | `018f580bd9d3` | 1447 | Retained | 1447 supplies the translated field-alias partial. |
| `docs/reference/templates/_imported-note-frontmatter.zh-CN.mdx` | `0e8029e260e0` | 1447 | Retained | 1447 supplies the translated imported-note partial. |
| `docs/reference/templates/data.zh-CN.mdx` | `9274ebeb8a16` | 1448 + 1447 | Completed | 1447 supplies missing authored sections; 18 generated tables retain English descriptions. |
| `docs/reference/templates/defaults.zh-CN.mdx` | `1bb3883b3a95` | 1448 | Completed; standards update | Shared technical-English rules apply. |
| `docs/reference/templates/eta-syntax.zh-CN.mdx` | `8483ba5dda8d` | 1448 | Completed; corrected; standards update | Shared technical-English rules apply. |
| `docs/reference/templates/frontmatter.zh-CN.mdx` | `a68c16462d40` | 1448 | Completed; corrected; standards update | Shared technical-English rules apply. |
| `docs/reference/templates/index.zh-CN.mdx` | `28aef87f7763` | 1448 | Retained | Shared technical-English rules apply. |
| `docs/reference/templates/profile-document.zh-CN.mdx` | `b2d3e2812e90` | 1448 | Completed; corrected | Shared technical-English rules apply. |
| `docs/reference/templates/profile-match.zh-CN.mdx` | `892ac022a09f` | 1448 | Completed | Shared technical-English rules apply. |
| `docs/reference/templates/syntax.zh-CN.mdx` | `1808989c3154` | 1448 | Completed; standards update | Shared technical-English rules apply. |
| `docs/reference/theme-hooks.zh-CN.mdx` | `6fa91ae594fa` | 1448 | Completed; standards update | Shared technical-English rules apply. |

### Blog: 3 pairs

| Chinese file | Chinese blob | Chosen source | Completion and correction | Decision or exception |
| --- | --- | --- | --- | --- |
| `blog/rebuilding-zotlit-v2-public-beta.zh-CN.mdx` | `6b027f8fcd97` | 1448 | Completed; corrected | Linked article title remains Reconnecting the Dots. |
| `blog/v2-release.zh-CN.mdx` | `e03d9203cf80` | 1448 | Completed; corrected; standards update | Linked title and fenced sample note remain English. |
| `blog/v2.1-release.zh-CN.mdx` | `ed60095d72d2` | 1448 | Completed; corrected | Shared technical-English rules apply. |

### Changelog: 19 pairs

| Chinese file | Chinese blob | Chosen source | Completion and correction | Decision or exception |
| --- | --- | --- | --- | --- |
| `changelog/2.0.0-beta.0.zh-CN.mdx` | `86a3b709f0ae` | 1448 | Retained | Shared technical-English rules apply. |
| `changelog/2.0.0-beta.1.zh-CN.mdx` | `c3aafddd4328` | 1448 | Retained | Shared technical-English rules apply. |
| `changelog/2.0.0-beta.2.zh-CN.mdx` | `92654a586098` | 1448 | Retained; corrected | Shared technical-English rules apply. |
| `changelog/2.0.0-beta.3.zh-CN.mdx` | `d6d1507890f4` | 1448 | Retained | Shared technical-English rules apply. |
| `changelog/2.0.0-beta.4.zh-CN.mdx` | `89dc129ac369` | 1448 | Retained | Shared technical-English rules apply. |
| `changelog/2.0.0.zh-CN.mdx` | `9413605ed5ef` | 1448 | Retained; standards update | Exact Failed to load plugin diagnostic remains English. |
| `changelog/2.0.1.zh-CN.mdx` | `592fb3637d0d` | 1448 | Retained | Shared technical-English rules apply. |
| `changelog/2.1.0-beta.0.zh-CN.mdx` | `a2ad1ff37bc4` | 1448 | Completed; corrected; standards update | Shared technical-English rules apply. |
| `changelog/2.1.0-beta.1.zh-CN.mdx` | `800cdcbd6944` | 1448 | Retained; standards update | Shared technical-English rules apply. |
| `changelog/2.1.0-beta.2.zh-CN.mdx` | `25914b407dc7` | 1448 | Retained; corrected | Shared technical-English rules apply. |
| `changelog/2.1.0-beta.3.zh-CN.mdx` | `95e2477fa589` | 1448 | Completed; corrected; standards update | Shared technical-English rules apply. |
| `changelog/2.1.0.zh-CN.mdx` | `78a19acf2cb9` | 1448 | Retained | Shared technical-English rules apply. |
| `changelog/2.1.1.zh-CN.mdx` | `e321fd3ee9da` | 1448 | Retained | Shared technical-English rules apply. |
| `changelog/2.1.2.zh-CN.mdx` | `6649b24ae4e4` | 1448 | Retained | Shared technical-English rules apply. |
| `changelog/2.1.3.zh-CN.mdx` | `9e6b70995693` | 1448 | Retained | Shared technical-English rules apply. |
| `changelog/2.1.4.zh-CN.mdx` | `a303c4fbb676` | 1448 | Retained; standards update | Shared technical-English rules apply. |
| `changelog/2.2.0-beta.0.zh-CN.mdx` | `62357e5c780b` | 1448 | Completed; corrected | Colorful Highlights remains a feature name. |
| `changelog/2.2.0-beta.1.zh-CN.mdx` | `d3c51faa7698` | 1448 | Completed; corrected | Shared technical-English rules apply. |
| `changelog/2.2.0-beta.2.zh-CN.mdx` | `3886a31e2db1` | 1448 | Completed; corrected | Shared technical-English rules apply. |

## Navigation metadata audit

Paths are relative to `apps/docs/content/`. Each Chinese file has a `meta.json` sibling. Page identifiers and order match English. Titles are translated; route names remain literal. The former translation-placeholder field has been removed.

| Chinese file | Chinese title | Source decision |
| --- | --- | --- |
| `docs/(intro)/meta.zh-CN.json` | 入门 | 1447 title; integration page order. |
| `docs/concepts/meta.zh-CN.json` | 核心概念 | Shared 1447/1448 content; integration page order. |
| `docs/how-to/meta.zh-CN.json` | 操作指南 | Shared 1447/1448 content; integration page order. |
| `docs/meta.zh-CN.json` | 文档 | Shared 1447/1448 page order; root breadcrumb title added at `a1d3d7d1`. |
| `docs/reference/meta.zh-CN.json` | 参考 | Shared 1447/1448 content; integration page order. |
| `docs/reference/templates/meta.zh-CN.json` | 模板 | Shared 1447/1448 content; integration page order. |
| `docs/tutorial/meta.zh-CN.json` | 教程 | Shared 1447/1448 content; integration page order. |

## UI catalog audit

| Source file pair | Audited scope | Result and boundary |
| --- | --- | --- |
| `messages/en.json` and `messages/zh-CN.json` | 157 `docs_*` keys per locale | Every key is present in both locales. English is the meaning source. All interpolation placeholders match. The five unchanged product/example values are listed below. The original-page label now reads “查看原始 v1 页面”, preserving the destination meaning in either locale. |
| `apps/docs/src/lib/fumadocs-translations.ts` | 51 native registry keys backed by 47 root messages | Uses the generated facade with an explicit locale. Reuses a message where registry contexts share the same text. Values are non-empty and `{url}` is preserved for native interpolation. The old app-local dictionaries are removed. |
| Other root-catalog values | 1,910 top-level values per locale | Preserved exactly from `a635872e`; this includes the nested `zotero` catalog and shared Workbench messages. Translation completeness outside `docs_*` was not audited here. |

### Docs message reconciliation

Of the original 110 site messages, 68 values are shared by both source PRs, 34 use 1448 wording, 2 use 1447 wording, and 6 were completed or corrected during integration. Another 47 native UI messages now live in the root catalogs. The following inventory names all 157 keys. It records source selection; it does not duplicate the catalogs' maintained text.

**Shared PR #1447 / PR #1448: 68 keys**

- `docs_redirect_translation_pending`
- `docs_dismiss_notice`
- `docs_workbench_showing_label`
- `docs_workbench_status`
- `docs_workbench_not_connected`
- `docs_workbench_connection_details`
- `docs_nav_docs`
- `docs_nav_blog`
- `docs_nav_changelog`
- `docs_nav_community`
- `docs_og_home_alt`
- `docs_og_home_kind`
- `docs_og_community_description`
- `docs_og_blog_title`
- `docs_og_documentation_kind`
- `docs_home_feature_notes`
- `docs_home_tutorial_link`
- `docs_home_how_to_link`
- `docs_home_feature_citations`
- `docs_home_feature_import`
- `docs_home_eyebrow`
- `docs_home_get_started`
- `docs_home_read_docs`
- `docs_home_example_title`
- `docs_home_example_page`
- `docs_community_description`
- `docs_community_og_alt`
- `docs_community_discord`
- `docs_community_join`
- `docs_community_discussions`
- `docs_community_open_discussions`
- `docs_blog_og_alt`
- `docs_blog_author`
- `docs_blog_read_post`
- `docs_changelog_og_alt`
- `docs_blog_post_og_alt`
- `docs_blog_post_byline`
- `docs_changelog_latest`
- `docs_not_found_title`
- `docs_not_found_docs`
- `docs_legacy_docs_link`
- `docs_release_channel_prerelease`
- `docs_release_channel_stable`
- `docs_table_prop`
- `docs_table_type`
- `docs_contract_signature`
- `docs_contract_liquid_filter`
- `docs_contract_examples`
- `docs_contract_example`
- `docs_contract_fields`
- `docs_command_label`
- `docs_command_copied_label`
- `docs_command_copy_label`
- `docs_command_copied`
- `docs_command_copy`
- `docs_settings`
- `docs_documentation`
- `docs_documentation_card_alt`
- `docs_next`
- `docs_previous`
- `docs_toggle_menu`
- `docs_open_search`
- `docs_last_updated`
- `docs_download_xpi`
- `docs_repo_stars`
- `docs_repo_downloads`
- `docs_zotero_minimum_version`
- `docs_release_desktop_only`

**PR #1448: 34 keys**

- `docs_workbench_sample_type_missing`
- `docs_workbench_connection_link_expired`
- `docs_og_home_description`
- `docs_og_community_title`
- `docs_og_blog_description`
- `docs_og_changelog_description`
- `docs_home_feature_notes_description`
- `docs_home_feature_citations_description`
- `docs_home_feature_annotations`
- `docs_home_feature_annotations_description`
- `docs_home_feature_import_description`
- `docs_home_title`
- `docs_home_description`
- `docs_home_example_note`
- `docs_community_chat_title`
- `docs_community_chat_description`
- `docs_community_ideas_title`
- `docs_community_ideas_description`
- `docs_community_heading`
- `docs_community_intro`
- `docs_blog_description`
- `docs_blog_intro`
- `docs_changelog_description`
- `docs_changelog_release_description`
- `docs_changelog_release_og_alt`
- `docs_changelog_open_github`
- `docs_not_found_description`
- `docs_license`
- `docs_companion_release`
- `docs_release_requires`
- `docs_close_banner`
- `docs_redirect_v1_notice`
- `docs_browse_xpi`
- `docs_locale_fallback`

**PR #1447: 2 keys**

- `docs_site_description`
- `docs_home_example_quote`

**Completed or corrected Chinese UI: 6 keys**

- `docs_changelog_intro`

- `docs_redirect_original_page`
- `docs_home_feature_templates`
- `docs_home_feature_templates_description`
- `docs_legacy_banner`
- `docs_read_in_english`

The 1447 selections are `docs_site_description` and `docs_home_example_quote`. The six integration edits translate the English-page action and agent-template wording, correct the v1-use question and original-page label, and use the canonical ZotLit Companion name in the changelog introduction. `docs_redirect_original_page` now describes the original v1 page without claiming every destination is Chinese.

Five values intentionally equal English: `docs_og_home_alt`, `docs_og_home_kind`, `docs_home_eyebrow`, `docs_home_example_title`, and `docs_community_discord`. They contain ZotLit/Zotero/Obsidian branding, the sample paper title, or Discord. They are not untranslated instructions.

### Root-backed native Fumadocs messages

The adapter in [`src/lib/fumadocs-translations.ts`](../src/lib/fumadocs-translations.ts) retains the entire native registry key, including context and accessibility suffixes. It calls generated `docs_fumadocs_*` messages with an explicit locale. There is one authored source for UI copy: the root catalogs.

`Search(search dialog)` and `Search(search trigger)` are separate keys backed by one message. The same reuse applies to the two language-switcher contexts, the two Close Sidebar contexts, and the two Open Sidebar contexts. Thus 47 root messages supply all 51 registry keys. `displayName` is the one key without a context suffix.

The adapter passes `{url}` through the generated message as a literal placeholder. Fumadocs replaces it with the current page URL when constructing page actions. Provider tests and the browser check confirm that page-action links contain the real localized URL rather than a literal `{url}`.

**Native messages: 47 keys**

- `docs_fumadocs_ask_ai`
- `docs_fumadocs_back_to_home`
- `docs_fumadocs_choose_a_language`
- `docs_fumadocs_close_banner`
- `docs_fumadocs_close_search`
- `docs_fumadocs_close_sidebar`
- `docs_fumadocs_collapse_sidebar`
- `docs_fumadocs_copied_text`
- `docs_fumadocs_copy_anchor_link`
- `docs_fumadocs_copy_link`
- `docs_fumadocs_copy_markdown`
- `docs_fumadocs_copy_text`
- `docs_fumadocs_dark`
- `docs_fumadocs_default`
- `docs_fumadocs_edit_on_github`
- `docs_fumadocs_hide_sidebar`
- `docs_fumadocs_language_name`
- `docs_fumadocs_last_updated_on`
- `docs_fumadocs_layout_tab`
- `docs_fumadocs_light`
- `docs_fumadocs_next_page`
- `docs_fumadocs_no_headings`
- `docs_fumadocs_no_results_found`
- `docs_fumadocs_not_found_description`
- `docs_fumadocs_on_this_page`
- `docs_fumadocs_open`
- `docs_fumadocs_open_in_chatgpt`
- `docs_fumadocs_open_in_claude`
- `docs_fumadocs_open_in_cursor`
- `docs_fumadocs_open_in_github`
- `docs_fumadocs_open_in_scira_ai`
- `docs_fumadocs_open_search`
- `docs_fumadocs_open_sidebar`
- `docs_fumadocs_page_not_found`
- `docs_fumadocs_parameters`
- `docs_fumadocs_previous_page`
- `docs_fumadocs_prop`
- `docs_fumadocs_read_url_prompt`
- `docs_fumadocs_returns`
- `docs_fumadocs_search`
- `docs_fumadocs_show_sidebar`
- `docs_fumadocs_system`
- `docs_fumadocs_table_of_contents`
- `docs_fumadocs_toggle_menu`
- `docs_fumadocs_toggle_theme`
- `docs_fumadocs_type`
- `docs_fumadocs_view_as_markdown`

The [registry tests](../src/lib/i18n.test.ts) compare the adapter output to the installed native registry in both locales. The [provider tests](../src/components/locale-provider.test.tsx) exercise rendered controls, accessible names, page actions, interpolation, and locale isolation. Check these tests when upgrading Fumadocs; translate values in the root catalogs rather than adding another dictionary.

## Completion-pass validation

These checks ran on the respective completion branches before the snapshot merge. They describe source and syntax evidence; later changes require a recheck.

| Scope | Source checks recorded | Limit |
| --- | --- | --- |
| 35 guide, concept, and tutorial MDX files; 7 metadata files | All 35 MDX files compile. No lost prior heading IDs, changed fenced code, changed imports, changed link targets, or broken authored fragment links were reported. Metadata retains English page order. | Later meaning corrections are included in `2ee71999`; independent re-review passed. |
| 38 reference, blog, and changelog MDX files | All 38 compile; all 176 content files parse. Preserves 378 effective heading IDs, with no technical-invariant or authored-fragment failures. Some explanatory code comments and a table prose label were translated; executable identifiers remain exact. | The 18 generated contract tables retain English copy. The later semantic corrections passed independent re-review at `2ee71999`. |
| 15 how-to MDX files | All 15 compile. Preserves 213 heading IDs and adds 122 explicit stable IDs. Imports, technical component properties, message calls, code, and link targets remain unchanged. | Whitespace-only JSX spacers were removed in two pages for Chinese layout. The 13 independent findings in this group are corrected and rechecked at `2ee71999`. |

The correction pass at `2ee71999` then compiled all 176 English/Chinese MDX files and verified technical parity in all 29 changed Chinese files. The Standards pass at `2233815f` again compiles all 176 files and preserves code fences, explicit anchors, and Markdown/JSX links in its 22 changed files. It intentionally changes imports and message calls to replace copied current UI labels with canonical components. At `eed6e179`, the heading check compares all 896 compiled IDs across all 88 Chinese files with `2ee71999` and reports no differences. The targeted anchor regression failed before the explicit-ID fix and passed afterward.

The 35/38/15 source inventories are disjoint and cover all 88 Chinese MDX files. The per-file rows above preserve their completion results. The earlier heuristic scans were used to find candidates; they are not evidence that a paragraph is correctly translated.

## Generated and intentional English

The generated exception is limited to `docs/reference/templates/data.zh-CN.mdx`. It has the same 18 `ContractTable` section identifiers as English:

- `note-and-content-templates`
- `annotation-template`
- `filename-template`
- `common-fields`
- `citation-templates`
- `citation-item`
- `cited-item-fields`
- `annotation-entry`
- `parent-item`
- `creators`
- `tags`
- `collections`
- `date-format`
- `extra-field`
- `extra-lines`
- `attachments`
- `related-items`
- `notes`

These tables use the shared contract model. Generated captions and descriptions retain their English source in both HTML and Markdown editions. Type signatures, field names, and examples keep their technical spelling. HTML table controls use localized root messages; the Markdown renderer also retains English column and detail labels. The table exception does not cover authored headings, explanations, or the two included Chinese partials. The [content transform](../content.config.ts) and [table renderer](../src/lib/template-contract/gfm.ts) own the generated output. A Chinese-only edit to generated field prose is not a durable localization method.

Code, API and protocol identifiers, command names, file paths, CSS selectors, template expressions, parameter values, exact diagnostics, and executable examples retain their technical spelling. Some prose examples contain English text to show the exact source input or output. Named external articles, contributor handles, and third-party UI labels retain their original form where needed to identify the source or control.

Other scope limits:

- Shared plugin, Companion, and Workbench catalog content outside `docs_*` retains its existing translation state.
- Screenshots and other embedded images are reused. Their pixels have not been localized in this pass.
- Shared OG artwork, third-party embeds, remote release data, and upstream product interfaces can contain English. Authored image labels and page metadata are part of the source-copy audit; translation of external or generated pixels is not.
- Missing future locale files still use the normal English fallback. Existing Chinese files select the Chinese edition immediately. Coverage states in this report are documentation only; they do not control routing, indexing, or content availability.

## Maintain and verify the report

When English or Chinese content changes, compare the complete source pair. Check conditions, prohibitions, side effects, numeric limits, warnings, omissions, and unsupported added claims. Review frontmatter and JSX labels as well as paragraphs. Preserve heading targets, links, imports, component/message bindings, code, and identifiers. A character count or successful MDX compile cannot prove meaning.

Run this inventory from the repository root. It uses tracked files, so an untracked browser fixture does not change the source count. It prints each pair and reports missing siblings. Counts are observations rather than requirements: new English-only pages are valid and use fallback.

```sh
python3 - <<'PY'
import json
from pathlib import Path
import subprocess

paths = subprocess.check_output(
    ['git', 'ls-files', 'apps/docs/content'], text=True
).splitlines()
english = {p for p in paths if p.endswith('.mdx') and not p.endswith('.zh-CN.mdx')}
chinese = {p for p in paths if p.endswith('.zh-CN.mdx')}
metadata = {p for p in paths if p.endswith('meta.zh-CN.json')}
for zh in sorted(chinese):
    en = zh.replace('.zh-CN.mdx', '.mdx')
    print('PAIR' if en in english else 'ORPHAN', en, zh)
print('English MDX:', len(english), 'Chinese MDX:', len(chinese))
print('Chinese pages:', sum(not Path(p).name.startswith('_') for p in chinese))
print('Chinese partials:', sum(Path(p).name.startswith('_') for p in chinese))
print('English-only:', sorted(p for p in english if p.replace('.mdx', '.zh-CN.mdx') not in chinese))
for zh in sorted(metadata):
    en = zh.replace('meta.zh-CN.json', 'meta.json')
    a, b = json.loads(Path(en).read_text()), json.loads(Path(zh).read_text())
    print('META', zh, 'same page order:', a.get('pages') == b.get('pages'))
for locale in ['en', 'zh-CN']:
    root = json.loads(Path(f'messages/{locale}.json').read_text())
    print(locale, 'docs keys:', sum(k.startswith('docs_') for k in root),
          'non-docs values:', sum(not k.startswith('docs_') for k in root),
          'native messages:', sum(k.startswith('docs_fumadocs_') for k in root))
PY
```

The inventory counts root-native messages, not adapter contexts. Run the docs registry tests to verify all 51 native contexts.

Use the pinned source revisions above for provenance, and compare current locale files directly with English for meaning. Update affected rows and known gaps when findings are fixed and rechecked. Record the source commit beside each new test or review result. Keep completion review, independent semantic review, and runtime verification separate.

Run the normal repository checks after integration, with the pinned toolchain and initialized dependencies:

```sh
pnpm exec turbo run test --filter=@zotlit/docs
pnpm --filter @zotlit/docs typecheck
pnpm lint
pnpm format
pnpm exec turbo run build --filter=@zotlit/docs
pnpm --filter @zotlit/docs exec node scripts/verify-i18n-http.mjs
```

Then verify representative Chinese content and UI in the browser, including search, theme and language controls, accessible labels, page actions, query/fragment preservation, and the English-only fallback. Follow [the verification report](i18n-verification.md) for the current observed results and limitations.
