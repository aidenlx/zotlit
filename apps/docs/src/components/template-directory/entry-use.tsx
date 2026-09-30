// An entry page's steps: where the reader puts the entry in Obsidian, in the plugin's own UI Labels.

import { asMarkdown } from "fumadocs-core/server";
import type { ReactNode } from "react";

import { Command } from "@/components/command";
import { Message } from "@/components/message";
import { SettingsPath } from "@/components/settings-path";
import { UiLabel } from "@/components/ui-label";
import { entryIdParts } from "@/lib/template-directory/site";
import type { EntryDetails, SiteEntry } from "@/lib/template-directory/site";
import { m } from "@/paraglide/messages.js";
import type { LocalizedString } from "@/paraglide/runtime.js";

import { COPY_LABEL, itemTypesInSentence } from "./labels";

const MERGE_LABEL = {
  replace: m.workbench_properties_merge_replace,
  append: m.workbench_properties_merge_append,
  keep: m.workbench_properties_merge_keep,
} satisfies Record<
  Extract<EntryDetails, { kind: "property" }>["merge"],
  () => string
>;

export function EntryUse({
  entry,
}: {
  entry: Pick<
    SiteEntry,
    "id" | "kind" | "title" | "details" | "matchedItemTypes"
  >;
}) {
  // The Markdown edition renders these steps too; see `lib/template-directory/markdown-edition.tsx`.
  const markdown = asMarkdown();
  const copy = <UiLabel name={COPY_LABEL[entry.kind]()} />;
  const [, slug] = entryIdParts(entry.id);
  switch (entry.details.kind) {
    case "profile":
      return (
        <Steps>
          <li>
            <p>
              <Message
                text={m.docs_directory_profile_step_one_click({
                  import: "{import}",
                })}
                slots={{ import: <UiLabel name={m.docs_directory_import()} /> }}
              />
            </p>
            {markdown && (
              <>
                <p>{m.docs_directory_profile_step_fallback()}</p>
                <ul>
                  <Step
                    text={m.docs_directory_profile_step_copy({
                      copy: "{copy}",
                      source: "{source}",
                    })}
                  >
                    {{
                      copy: <UiLabel name={m.docs_directory_copy_it()} />,
                      source: (
                        <UiLabel name={m.docs_directory_source_heading()} />
                      ),
                    }}
                  </Step>
                  <Step
                    text={m.docs_directory_profile_step_import({
                      command: "{command}",
                      clipboard: "{clipboard}",
                      file: "{file}",
                    })}
                  >
                    {{
                      command: (
                        <Command
                          inline
                          name={m.command_import_profile_name()}
                        />
                      ),
                      clipboard: (
                        <UiLabel name={m.profile_import_clipboard()} />
                      ),
                      file: <UiLabel name={m.profile_import_file()} />,
                    }}
                  </Step>
                </ul>
              </>
            )}
          </li>
          <Step
            text={m.docs_directory_profile_step_confirm({
              confirm: "{confirm}",
            })}
          >
            {{ confirm: <UiLabel name={m.profile_import_confirm()} /> }}
          </Step>
          {entry.matchedItemTypes === null ? (
            <Step
              text={m.docs_directory_profile_step_create({ name: "{name}" })}
            >
              {{ name: <strong>{entry.title}</strong> }}
            </Step>
          ) : (
            <li>
              {m.docs_directory_profile_step_create_matched({
                types: itemTypesInSentence(entry.matchedItemTypes, "singular"),
              })}
            </li>
          )}
        </Steps>
      );
    case "partial": {
      const { context } = entry.details;
      return (
        <Steps>
          <Step
            text={m.docs_directory_partial_step_add({
              setting: "{setting}",
              add: "{add}",
              name: "{name}",
            })}
          >
            {{
              setting: <UiLabel name={m.settings_partials_heading()} />,
              add: <UiLabel name={m.settings_partial_add()} />,
              name: <code>{slug}</code>,
            }}
          </Step>
          <Step text={m.docs_directory_partial_step_paste({ copy: "{copy}" })}>
            {{ copy }}
          </Step>
          <Step text={m.docs_directory_partial_step_call({ tab: "{tab}" })}>
            {{
              tab: (
                <UiLabel
                  name={
                    context === "note"
                      ? m.workbench_tab_note()
                      : m.workbench_tab_annotation()
                  }
                />
              ),
            }}
          </Step>
        </Steps>
      );
    }
    case "citation":
      return (
        <Steps>
          <Step
            text={m.docs_directory_citation_step_open({
              row: "{row}",
              open: "{open}",
            })}
          >
            {{
              row: <UiLabel name={m.settings_citation_text_name()} />,
              open: <UiLabel name={m.settings_citation_text_open()} />,
            }}
          </Step>
          <Step
            text={m.docs_directory_step_replace_tab({
              copy: "{copy}",
              tab: "{tab}",
            })}
          >
            {{ copy, tab: <UiLabel name={m.workbench_tab_citation()} /> }}
          </Step>
        </Steps>
      );
    case "note-name":
      return (
        <Steps>
          <TabStep tab={m.workbench_tab_name_and_folder()} />
          <Step
            text={m.docs_directory_step_replace_field({
              copy: "{copy}",
              field: "{field}",
            })}
          >
            {{
              copy,
              field: <UiLabel name={m.workbench_name_filename_heading()} />,
            }}
          </Step>
        </Steps>
      );
    case "property": {
      const { key, merge } = entry.details;
      if (key === null) {
        return (
          <Steps>
            <TabStep tab={m.workbench_tab_properties()} />
            <Step
              text={m.docs_directory_property_step_add_spread({
                spread: "{spread}",
                copy: "{copy}",
              })}
            >
              {{
                spread: <UiLabel name={m.workbench_properties_add_spread()} />,
                copy,
              }}
            </Step>
            <Step
              text={m.docs_directory_property_step_merge({
                merge: "{merge}",
                choice: "{choice}",
              })}
            >
              {{
                merge: <UiLabel name={m.workbench_properties_merge()} />,
                choice: <UiLabel name={MERGE_LABEL[merge]()} />,
              }}
            </Step>
          </Steps>
        );
      }
      return (
        <Steps>
          <TabStep tab={m.workbench_tab_properties()} />
          <li>
            <p>
              <Message
                text={m.docs_directory_property_step_add({ add: "{add}" })}
                slots={{ add: <UiLabel name={m.workbench_properties_add()} /> }}
              />
            </p>
            <table>
              <thead>
                <tr>
                  <th>{m.docs_directory_input()}</th>
                  <th>{m.docs_directory_value()}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <UiLabel name={m.workbench_properties_name()} />
                  </td>
                  <td>
                    <code>{key}</code>
                  </td>
                </tr>
                <tr>
                  <td>
                    <UiLabel name={m.workbench_properties_format()} />
                  </td>
                  <td>
                    <Message
                      text={m.docs_directory_property_format({
                        rule: "{rule}",
                        reset: "{reset}",
                      })}
                      slots={{
                        rule: (
                          <UiLabel
                            name={m.workbench_properties_format_rule()}
                          />
                        ),
                        reset: (
                          <UiLabel
                            name={m.workbench_properties_format_reset()}
                          />
                        ),
                      }}
                    />
                  </td>
                </tr>
                <tr>
                  <td>
                    <UiLabel name={m.workbench_properties_expression()} />
                  </td>
                  <td>
                    <Message
                      text={m.docs_directory_property_paste({
                        copy: "{copy}",
                      })}
                      slots={{ copy }}
                    />
                  </td>
                </tr>
                <tr>
                  <td>
                    <UiLabel name={m.workbench_properties_merge()} />
                  </td>
                  <td>
                    <UiLabel name={MERGE_LABEL[merge]()} />
                  </td>
                </tr>
              </tbody>
            </table>
          </li>
        </Steps>
      );
    }
  }
}

function Steps({ children }: { children: ReactNode }) {
  asMarkdown();
  return <ol>{children}</ol>;
}

/** One step: a sentence of the site's catalog with the plugin's UI Labels in its slots. */
function Step({
  text,
  children,
}: {
  text: string;
  children: Record<string, ReactNode>;
}) {
  asMarkdown();
  return (
    <li>
      <Message text={text} slots={children} />
    </li>
  );
}

function TabStep({ tab }: { tab: LocalizedString }) {
  asMarkdown();
  return (
    <Step text={m.docs_directory_open_tab_step({ tab: "{tab}" })}>
      {{ tab: <UiLabel name={tab} /> }}
    </Step>
  );
}

/**
 * The first line under a part's result: which look it changes and where to
 * open it. The Markdown edition renders this line too.
 */
export function EntryChanges({ entry }: { entry: Pick<SiteEntry, "kind"> }) {
  asMarkdown();
  if (entry.kind === "profile") return null;
  if (entry.kind === "citation") {
    return (
      <p>
        <Message
          text={m.docs_directory_changes_citation({ path: "{path}" })}
          slots={{
            path: <SettingsPath page={m.settings_page_citations()} />,
          }}
        />
      </p>
    );
  }
  return (
    <p>
      <Message
        text={m.docs_directory_changes_look({ path: "{path}", edit: "{edit}" })}
        slots={{
          path: <SettingsPath page={m.settings_page_profiles()} />,
          edit: <UiLabel name={m.settings_profile_edit()} />,
        }}
      />
    </p>
  );
}
