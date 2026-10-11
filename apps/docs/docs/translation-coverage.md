# Bilingual translation coverage

Snapshot: 2026-10-11, integration commit `2ee71999` on `poc/docs-i18n` for [PR #1446](https://github.com/aidenlx/zotlit/pull/1446).

This report records the English and Simplified Chinese source pairs, translation choices, and known limits. It covers tracked source files. Temporary browser fixtures are excluded. [The editing guide](i18n.md) explains the file layout. [The verification report](i18n-verification.md) owns the final build, HTTP, browser, and review results.

## Result and scope

- All **88 English MDX sources have 88 Chinese siblings**: 85 pages and 3 included partials. The completion audit covers frontmatter, headings, authored prose, tables, callouts, and component labels in each pair.
- **65 Chinese files were completed or revised**, and **23 already-translated files were reviewed and retained** during the completion pass. That pass reports no remaining untranslated authored prose. These are source-review results, not a count of Chinese characters or a claim that every translation is correct.
- All **7 navigation metadata pairs** are covered: 6 translated section titles and 1 ordering-only root file.
- Each root catalog has **110 `docs_*` keys**. Five values retain intentional product or example text. All **1,910 non-docs top-level values**, including nested values, match the original `a635872e` baseline in each locale.
- Each native Fumadocs dictionary has **51 registry keys**: 50 context-qualified keys plus `displayName`. Both locales use the installed registry. The older 46-key dictionary used raw keys and did not supply the correct lookup keys.
- The Chinese template-data page has **18 generated `ContractTable` sections** whose generated descriptions and table copy remain English. Its authored surrounding prose and both handwritten partials are translated.

**Independent semantic re-review passed at `2ee71999`.** Paired review covers all 88 MDX pairs, the 7 metadata pairs, and all 110 docs catalog values. It found 39 corrections at the prior checkpoint: 15 P2 and 24 P3, with no P0 or P1 finding. The correction pass changed 29 Chinese MDX files and `docs_redirect_original_page`. Re-review closed all 39 findings and found no new meaning drift. Code, imports, UI calls, explicit IDs, links, and includes remain unchanged by that pass.

At `2ee71999`, 342 docs tests and App/Node typechecks passed. All 176 English/Chinese MDX files compile; source-parity checks pass. Root lint has zero errors and five existing warnings outside these changes; formatting passes. The earlier normal production build, 7,746 HTTP checks, and browser checks passed at `ba4b68c7` with a temporary English-only fixture. That fixture has been removed. The clean post-correction build, runtime checks, and final Standards/Spec reviews remain pending. See [the verification report](i18n-verification.md) for the exact scope; these results do not imply a CI, publication, or deployment result.

## Source reconciliation

Both source PRs contribute real translations. They are divergent sources; importing one does not include the other.

| Source | Pinned revision | Role |
| --- | --- | --- |
| [PR #1447](https://github.com/aidenlx/zotlit/pull/1447) | `675c8b3265c8e2d20cb424180f7fe00864a189e4` | Complementary introduction/tutorial wording, the intro navigation title, missing template-data sections and partials, site description, and example quote. |
| [PR #1448](https://github.com/aidenlx/zotlit/pull/1448) | `f8bd34ec1be87cc57efa6b3e2016ac886ce5942e` | Main translated foundation for the other pages, metadata, and UI copy. |
| Integration completion | `f042e2fa`, `565b551e`, `05a844c7` | Complete remaining authored English, reconcile both sources, repair MDX syntax, retain stable headings, and correct meaning against the English sibling. |
| Native UI repair | `10e151db` | Map translated values to the installed 51-key registry; cover both displayed and accessible labels. |
| Semantic corrections | `2ee71999` | Correct all 39 independent findings in 29 MDX files and one docs message; independent re-review passed. |

The per-file source column records the chosen wording, not exclusive authorship of a whole file. Shared source text is retained. Where sources differ, the English sibling determines the meaning. MDX repairs preserve component contracts, message bindings, examples, and link targets. The completion pass keeps 1447 contributions in 13 MDX files, one metadata file, and two docs catalog values. The source commits remain the durable comparison points.

## Per-file MDX audit

Paths below are relative to `apps/docs/content/`. Each row names the Chinese file and its 12-character Git blob ID at `2ee71999`; remove `.zh-CN` for its English source at the same commit. A filename beginning with `_` is an included partial, not a standalone page.

- **Completed**: the completion pass translated remaining authored text or revised existing copy against English.
- **Retained**: that pass reviewed already-translated authored copy and kept it.
- Both states report no remaining authored English gap in the scoped completion audit. A **corrected** suffix identifies the 29 files changed by the later `2ee71999` correction pass. Independent semantic re-review covers every row and passed at that commit.
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
| `docs/concepts/how-citekey-links-work.zh-CN.mdx` | `3420d66bfd6b` | 1448 | Completed | Shared technical-English rules apply. |
| `docs/concepts/how-templates-work.zh-CN.mdx` | `43957904d6c6` | 1448 | Completed | Shared technical-English rules apply. |
| `docs/concepts/how-zotlit-connects-to-zotero.zh-CN.mdx` | `1af2f6accbff` | 1448 | Completed | Shared technical-English rules apply. |
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
| `docs/how-to/edit-pdf-annotations.zh-CN.mdx` | `ba7089ce342d` | 1448 | Completed | Retains the warning that avoiding overlapping edits does not guarantee safety. |
| `docs/how-to/enable-javascript-templates.zh-CN.mdx` | `934f8821da72` | 1448 | Completed | Shared technical-English rules apply. |
| `docs/how-to/explore-citations-in-graph.zh-CN.mdx` | `4d34b62c6ec1` | 1448 | Completed; corrected | Exact Obsidian graph controls, commands, colors, and property names remain unchanged. |
| `docs/how-to/explore-template-data.zh-CN.mdx` | `c04248c5f12a` | 1448 | Completed; corrected | Localized partial include; API fields and template syntax stay exact. |
| `docs/how-to/export-note-with-citations.zh-CN.mdx` | `d656b3f808d0` | 1448 | Completed; corrected | Exact Zotero control path and API permission label remain unchanged. |
| `docs/how-to/export-with-native-pandoc.zh-CN.mdx` | `e45df3141086` | 1448 | Completed; corrected | CLI, YAML, Markdown, terminal output, and error codes stay exact. |
| `docs/how-to/fix-stale-data.zh-CN.mdx` | `32fb471adecc` | 1448 | Completed; corrected | Full copy applies on each refresh; removes an unsupported freshness guarantee. |
| `docs/how-to/import-zotero-notes.zh-CN.mdx` | `4d41e1011e0c` | 1448 | Completed; corrected | Localized partial include; fenced examples and My Library stay exact. |
| `docs/how-to/index.zh-CN.mdx` | `2c31239f87be` | 1448 | Retained | Shared technical-English rules apply. |
| `docs/how-to/insert-citations.zh-CN.mdx` | `17a007495557` | 1448 | Completed | Quoted notice matches the existing Chinese plugin catalog; citation examples stay exact. |
| `docs/how-to/keep-notes-updated.zh-CN.mdx` | `6d6d92d58a7d` | 1448 | Completed | Shared technical-English rules apply. |
| `docs/how-to/migrate-from-2.1-templates.zh-CN.mdx` | `8f6ff2530fa4` | 1448 | Completed; corrected | Shared technical-English rules apply. |
| `docs/how-to/migrate-from-pandoc-reference-list.zh-CN.mdx` | `dcc29d8bb45a` | 1448 | Completed; corrected | Shared technical-English rules apply. |
| `docs/how-to/migrate-from-v1.zh-CN.mdx` | `246865d74d7d` | 1448 | Completed | Shared technical-English rules apply. |
| `docs/how-to/migrate-from-zotero-integration.zh-CN.mdx` | `6b811f3b2d38` | 1448 | Completed; corrected | Shared technical-English rules apply. |
| `docs/how-to/migrate-v1-eta-templates.zh-CN.mdx` | `c910e1fba570` | 1448 | Completed | Shared technical-English rules apply. |
| `docs/how-to/open-pdf-in-obsidian.zh-CN.mdx` | `d361fc401887` | 1448 | Completed; corrected | Shared technical-English rules apply. |
| `docs/how-to/review-copy-troubleshoot-references.zh-CN.mdx` | `b22e14f71c52` | 1448 | Completed | Shared technical-English rules apply. |
| `docs/how-to/set-up-live-updates.zh-CN.mdx` | `fc72f6357472` | 1448 | Completed; corrected | Shared technical-English rules apply. |
| `docs/how-to/suppress-zotero-security-prompt.zh-CN.mdx` | `c5b0b329ab8c` | 1448 | Completed | Shared technical-English rules apply. |
| `docs/how-to/sync-across-devices.zh-CN.mdx` | `05dcdbdfca78` | 1448 | Completed | Shared technical-English rules apply. |
| `docs/how-to/update-obsidian-installer.zh-CN.mdx` | `889f6324f060` | 1448 | Retained | Shared technical-English rules apply. |
| `docs/how-to/use-annotation-view.zh-CN.mdx` | `d60c2eee56c5` | 1448 | Completed; corrected | Shared technical-English rules apply. |
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
| `docs/reference/commands.zh-CN.mdx` | `f39f9e19a07a` | 1448 | Completed | Shared technical-English rules apply. |
| `docs/reference/index.zh-CN.mdx` | `3498ce275691` | 1448 | Retained | Shared technical-English rules apply. |
| `docs/reference/protocol-links.zh-CN.mdx` | `8e2a1d1cb513` | 1448 | Completed | Action-name headings remain exact protocol identifiers. |
| `docs/reference/settings.zh-CN.mdx` | `c398103b7bad` | 1448 | Completed | Shared technical-English rules apply. |
| `docs/reference/template-workbench-cli.zh-CN.mdx` | `59718a49cb48` | 1448 | Completed | Shared technical-English rules apply. |
| `docs/reference/templates/_field-aliases.zh-CN.mdx` | `018f580bd9d3` | 1447 | Retained | 1447 supplies the translated field-alias partial. |
| `docs/reference/templates/_imported-note-frontmatter.zh-CN.mdx` | `0e8029e260e0` | 1447 | Retained | 1447 supplies the translated imported-note partial. |
| `docs/reference/templates/data.zh-CN.mdx` | `9274ebeb8a16` | 1448 + 1447 | Completed | 1447 supplies missing authored sections; 18 generated tables retain English descriptions. |
| `docs/reference/templates/defaults.zh-CN.mdx` | `d952a7ad7715` | 1448 | Completed | Shared technical-English rules apply. |
| `docs/reference/templates/eta-syntax.zh-CN.mdx` | `4158a1663e60` | 1448 | Completed; corrected | Shared technical-English rules apply. |
| `docs/reference/templates/frontmatter.zh-CN.mdx` | `425988b7901c` | 1448 | Completed; corrected | Shared technical-English rules apply. |
| `docs/reference/templates/index.zh-CN.mdx` | `28aef87f7763` | 1448 | Retained | Shared technical-English rules apply. |
| `docs/reference/templates/profile-document.zh-CN.mdx` | `b2d3e2812e90` | 1448 | Completed; corrected | Shared technical-English rules apply. |
| `docs/reference/templates/profile-match.zh-CN.mdx` | `892ac022a09f` | 1448 | Completed | Shared technical-English rules apply. |
| `docs/reference/templates/syntax.zh-CN.mdx` | `69edd9ef179e` | 1448 | Completed | Shared technical-English rules apply. |
| `docs/reference/theme-hooks.zh-CN.mdx` | `328a78513bca` | 1448 | Completed | Shared technical-English rules apply. |

### Blog: 3 pairs

| Chinese file | Chinese blob | Chosen source | Completion and correction | Decision or exception |
| --- | --- | --- | --- | --- |
| `blog/rebuilding-zotlit-v2-public-beta.zh-CN.mdx` | `6b027f8fcd97` | 1448 | Completed; corrected | Linked article title remains Reconnecting the Dots. |
| `blog/v2-release.zh-CN.mdx` | `b874d5fb3207` | 1448 | Completed; corrected | Linked title and fenced sample note remain English. |
| `blog/v2.1-release.zh-CN.mdx` | `ed60095d72d2` | 1448 | Completed; corrected | Shared technical-English rules apply. |

### Changelog: 19 pairs

| Chinese file | Chinese blob | Chosen source | Completion and correction | Decision or exception |
| --- | --- | --- | --- | --- |
| `changelog/2.0.0-beta.0.zh-CN.mdx` | `86a3b709f0ae` | 1448 | Retained | Shared technical-English rules apply. |
| `changelog/2.0.0-beta.1.zh-CN.mdx` | `c3aafddd4328` | 1448 | Retained | Shared technical-English rules apply. |
| `changelog/2.0.0-beta.2.zh-CN.mdx` | `92654a586098` | 1448 | Retained; corrected | Shared technical-English rules apply. |
| `changelog/2.0.0-beta.3.zh-CN.mdx` | `d6d1507890f4` | 1448 | Retained | Shared technical-English rules apply. |
| `changelog/2.0.0-beta.4.zh-CN.mdx` | `89dc129ac369` | 1448 | Retained | Shared technical-English rules apply. |
| `changelog/2.0.0.zh-CN.mdx` | `5524ccb01388` | 1448 | Retained | Exact Failed to load plugin diagnostic remains English. |
| `changelog/2.0.1.zh-CN.mdx` | `592fb3637d0d` | 1448 | Retained | Shared technical-English rules apply. |
| `changelog/2.1.0-beta.0.zh-CN.mdx` | `817aa77f19d6` | 1448 | Completed; corrected | Shared technical-English rules apply. |
| `changelog/2.1.0-beta.1.zh-CN.mdx` | `5f71a5a5805f` | 1448 | Retained | Shared technical-English rules apply. |
| `changelog/2.1.0-beta.2.zh-CN.mdx` | `25914b407dc7` | 1448 | Retained; corrected | Shared technical-English rules apply. |
| `changelog/2.1.0-beta.3.zh-CN.mdx` | `6c516c911146` | 1448 | Completed; corrected | Shared technical-English rules apply. |
| `changelog/2.1.0.zh-CN.mdx` | `78a19acf2cb9` | 1448 | Retained | Shared technical-English rules apply. |
| `changelog/2.1.1.zh-CN.mdx` | `e321fd3ee9da` | 1448 | Retained | Shared technical-English rules apply. |
| `changelog/2.1.2.zh-CN.mdx` | `6649b24ae4e4` | 1448 | Retained | Shared technical-English rules apply. |
| `changelog/2.1.3.zh-CN.mdx` | `9e6b70995693` | 1448 | Retained | Shared technical-English rules apply. |
| `changelog/2.1.4.zh-CN.mdx` | `4f47c1c67e4b` | 1448 | Retained | Shared technical-English rules apply. |
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
| `docs/meta.zh-CN.json` | No title; ordering only | Shared 1447/1448 content; integration page order. |
| `docs/reference/meta.zh-CN.json` | 参考 | Shared 1447/1448 content; integration page order. |
| `docs/reference/templates/meta.zh-CN.json` | 模板 | Shared 1447/1448 content; integration page order. |
| `docs/tutorial/meta.zh-CN.json` | 教程 | Shared 1447/1448 content; integration page order. |

## UI catalog audit

| Source file pair | Audited scope | Result and boundary |
| --- | --- | --- |
| `messages/en.json` and `messages/zh-CN.json` | 110 `docs_*` keys per locale | Every key is present in both locales. English is the meaning source. All interpolation placeholders match. The five unchanged product/example values are listed below. The original-page label now reads “查看原始 v1 页面”, preserving the destination meaning in either locale. |
| `apps/docs/i18n/en.json` and `apps/docs/i18n/zh-CN.json` | 51 `fumadocs` keys per locale | Exact installed registry coverage, including `displayName`; all values are non-empty and `{url}` is preserved. English displays English values rather than context suffixes. Chinese covers visible labels and accessible names. |
| Other root-catalog values | 1,910 top-level values per locale | Preserved exactly from `a635872e`; this includes the nested `zotero` catalog and shared Workbench messages. Translation completeness outside `docs_*` was not audited here. |

### Docs message reconciliation

At this snapshot, 68 values are shared by both source PRs, 35 use 1448 wording, 2 use 1447 wording, and 5 were completed or corrected during integration. The following inventory names all 110 audited keys. It records source selection; it does not duplicate the catalogs' maintained text.

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

**PR #1448: 35 keys**

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
- `docs_changelog_intro`
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

**Completed or corrected Chinese UI: 5 keys**

- `docs_redirect_original_page`

- `docs_home_feature_templates`
- `docs_home_feature_templates_description`
- `docs_legacy_banner`
- `docs_read_in_english`

The 1447 selections are `docs_site_description` and `docs_home_example_quote`. The five integration edits translate the English-page action and agent-template wording, and correct the v1-use question and original-page label. `docs_redirect_original_page` now describes the original v1 page without claiming every destination is Chinese.

Five values intentionally equal English: `docs_og_home_alt`, `docs_og_home_kind`, `docs_home_eyebrow`, `docs_home_example_title`, and `docs_community_discord`. They contain ZotLit/Zotero/Obsidian branding, the sample paper title, or Discord. They are not untranslated instructions.

### Native Fumadocs dictionary

Keep the entire registry key, including its context and accessibility suffix. For example, `Search(search dialog)` and `Search(search trigger)` are separate keys with the same translated value. `Close Sidebar(aria-label)` and `Close Sidebar(sidebar)(aria-label)` are also separate keys. `displayName` is the one key without a context suffix.

The native UI fix migrated reusable source translations to those registry keys and supplied the additional registry entries. The exact-registry tests in [`src/lib/i18n.test.ts`](../src/lib/i18n.test.ts) check both locale files. The provider tests in [`src/components/locale-provider.test.tsx`](../src/components/locale-provider.test.tsx) exercise rendered search, theme, and page-action copy. The native-fix branch reports 342 docs tests in 42 files passed. That branch result is not the final integrated browser or build result.

## Completion-pass validation

These checks ran on the respective completion branches before the snapshot merge. They describe source and syntax evidence; later changes require a recheck.

| Scope | Source checks recorded | Limit |
| --- | --- | --- |
| 35 guide, concept, and tutorial MDX files; 7 metadata files | All 35 MDX files compile. No lost prior heading IDs, changed fenced code, changed imports, changed link targets, or broken authored fragment links were reported. Metadata retains English page order. | Later meaning corrections are included in `2ee71999`; independent re-review passed. |
| 38 reference, blog, and changelog MDX files | All 38 compile; all 176 content files parse. Preserves 378 effective heading IDs, with no technical-invariant or authored-fragment failures. Some explanatory code comments and a table prose label were translated; executable identifiers remain exact. | The 18 generated contract tables retain English copy. The later semantic corrections passed independent re-review at `2ee71999`. |
| 15 how-to MDX files | All 15 compile. Preserves 213 heading IDs and adds 122 explicit stable IDs. Imports, technical component properties, message calls, code, and link targets remain unchanged. | Whitespace-only JSX spacers were removed in two pages for Chinese layout. The 13 independent findings in this group are corrected and rechecked at `2ee71999`. |

The correction pass at `2ee71999` then compiled all 176 English/Chinese MDX files and verified technical parity in all 29 changed Chinese files.

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

These tables use the shared contract model. Captions, descriptions, type signatures, field names, and generated table content remain English in both HTML and Markdown editions. The table exception does not cover authored headings, explanations, or the two included Chinese partials. The [content transform](../content.config.ts) and [table renderer](../src/lib/template-contract/gfm.ts) own the generated output. A Chinese-only edit to generated field prose is not a durable localization method.

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
    native = json.loads(Path(f'apps/docs/i18n/{locale}.json').read_text())['fumadocs']
    print(locale, 'docs keys:', sum(k.startswith('docs_') for k in root),
          'non-docs values:', sum(not k.startswith('docs_') for k in root),
          'native UI keys:', len(native))
PY
```

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
